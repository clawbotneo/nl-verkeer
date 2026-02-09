/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal X API client for fetching extra traffic context from @RWSverkeersinfo.
// Prefer the user timeline endpoint (more widely available than Recent Search in some tiers),
// then match locally on road code.

const X_API_BASES = ['https://api.x.com/2', 'https://api.twitter.com/2'];

export type ExternalPost = {
  id: string;
  text: string;
  createdAt?: string;
  url: string;
};

type CacheEntry = { fetchedAt: number; post?: ExternalPost };

type TweetsCache = { fetchedAt: number; tweets: Array<{ id: string; text: string; created_at?: string }> };

declare global {
  // Cache per roadCode to avoid hammering X.
  // eslint-disable-next-line no-var
  var __nlVerkeerXCache: Map<string, CacheEntry> | undefined;
  // Cache the latest tweets list to avoid N requests (one per road).
  // eslint-disable-next-line no-var
  var __nlVerkeerRwsTweetsCache: TweetsCache | undefined;
  // Cache user id lookup.
  // eslint-disable-next-line no-var
  var __nlVerkeerRwsUserId: { fetchedAt: number; id: string } | undefined;
  // Last X error for debugging.
  // eslint-disable-next-line no-var
  var __nlVerkeerXLastError: { at: number; msg: string } | undefined;
}

// Only refresh X data every 5 minutes (when enabled); keeps costs predictable.
const CACHE_TTL_MS = 5 * 60 * 1000;
const USERID_TTL_MS = 24 * 60 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

function getCache(): Map<string, CacheEntry> {
  if (!globalThis.__nlVerkeerXCache) globalThis.__nlVerkeerXCache = new Map();
  return globalThis.__nlVerkeerXCache;
}

function normalizeRoadCode(roadCode: string): string {
  return roadCode.trim().toUpperCase().replace(/\s+/g, '');
}

function roadRegex(roadCode: string): RegExp {
  // Match "A58" or "A 58" or "A-58" as a whole token.
  const rc = normalizeRoadCode(roadCode);
  const type = rc[0];
  const num = rc.slice(1);
  return new RegExp(`\\b${type}\\s*[- ]?\\s*${num}\\b`, 'i');
}

async function xFetchJson(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': 'nl-verkeer/1.0 (+https://github.com/clawbotneo/nl-verkeer)',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`X API HTTP ${res.status}${body ? ` - ${body.slice(0, 200)}` : ''}`);
  }
  return await res.json();
}

async function getRwsUserId(token: string): Promise<string> {
  const now = Date.now();
  const cached = globalThis.__nlVerkeerRwsUserId;
  if (cached && now - cached.fetchedAt < USERID_TTL_MS) return cached.id;

  let lastErr: unknown;
  for (const base of X_API_BASES) {
    try {
      const u = new URL(`${base}/users/by/username/RWSverkeersinfo`);
      const json = await withTimeout(xFetchJson(u.toString(), token), 5000, 'getRwsUserId');
      const id = json?.data?.id;
      if (typeof id === 'string' && id) {
        globalThis.__nlVerkeerRwsUserId = { fetchedAt: now, id };
        return id;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error('Failed to resolve RWSverkeersinfo user id');
  globalThis.__nlVerkeerXLastError = { at: now, msg: err.message };
  throw err;
}

async function getRwsLatestTweets(token: string): Promise<Array<{ id: string; text: string; created_at?: string }>> {
  const now = Date.now();
  const cached = globalThis.__nlVerkeerRwsTweetsCache;
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.tweets;

  const userId = await getRwsUserId(token);

  let lastErr: unknown;
  for (const base of X_API_BASES) {
    try {
      const u = new URL(`${base}/users/${userId}/tweets`);
      u.searchParams.set('max_results', '20');
      u.searchParams.set('exclude', 'retweets,replies');
      u.searchParams.set('tweet.fields', 'created_at');

      const json = await withTimeout(xFetchJson(u.toString(), token), 5000, 'getRwsLatestTweets');
      const tweets = Array.isArray(json?.data) ? json.data : [];
      const clean = tweets
        .filter((t: any) => typeof t?.id === 'string' && typeof t?.text === 'string')
        .map((t: any) => ({ id: t.id, text: t.text, created_at: typeof t.created_at === 'string' ? t.created_at : undefined }));

      globalThis.__nlVerkeerRwsTweetsCache = { fetchedAt: now, tweets: clean };
      return clean;
    } catch (e) {
      lastErr = e;
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error('Failed to fetch RWSverkeersinfo tweets');
  globalThis.__nlVerkeerXLastError = { at: now, msg: err.message };
  throw err;
}

export async function fetchRwsExternalInfoForRoad(roadCode: string): Promise<ExternalPost | undefined> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return undefined;

  const rc = normalizeRoadCode(roadCode);
  if (!/^[AN]\d{1,3}$/.test(rc)) return undefined;

  const cache = getCache();
  const now = Date.now();
  const cached = cache.get(rc);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.post;

  try {
    const tweets = await getRwsLatestTweets(token);
    const re = roadRegex(rc);

    // Ignore posts older than 1 hour.
    const cutoff = Date.now() - 60 * 60 * 1000;
    const hit = tweets.find((t) => {
      if (!re.test(t.text)) return false;
      if (!t.created_at) return false;
      const ts = Date.parse(t.created_at);
      if (!Number.isFinite(ts)) return false;
      return ts >= cutoff;
    });
    const post: ExternalPost | undefined = hit
      ? {
          id: hit.id,
          text: hit.text,
          createdAt: hit.created_at,
          url: `https://x.com/RWSverkeersinfo/status/${hit.id}`,
        }
      : undefined;

    cache.set(rc, { fetchedAt: now, post });
    return post;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown X error';
    globalThis.__nlVerkeerXLastError = { at: now, msg };
    cache.set(rc, { fetchedAt: now, post: undefined });
    return undefined;
  }
}

export function getXLastError(): { at: number; msg: string } | undefined {
  return globalThis.__nlVerkeerXLastError;
}

