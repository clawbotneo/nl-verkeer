/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal X API client for fetching extra traffic context from @RWSverkeersinfo.
// Uses official X API v2 recent search.

// X currently supports both api.x.com and api.twitter.com; keep a fallback for reliability.
const X_API_BASES = ['https://api.x.com/2', 'https://api.twitter.com/2'];

export type ExternalPost = {
  id: string;
  text: string;
  createdAt?: string;
  url: string;
};

type CacheEntry = { fetchedAt: number; post?: ExternalPost };

declare global {
  // Cache per roadCode to avoid hammering X.
  // eslint-disable-next-line no-var
  var __nlVerkeerXCache: Map<string, CacheEntry> | undefined;
}

const CACHE_TTL_MS = 3 * 60 * 1000;

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

export async function fetchRwsExternalInfoForRoad(roadCode: string): Promise<ExternalPost | undefined> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return undefined;

  const rc = normalizeRoadCode(roadCode);
  if (!/^[AN]\d{1,3}$/.test(rc)) return undefined;

  const cache = getCache();
  const now = Date.now();
  const cached = cache.get(rc);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.post;

  // Query: match road code mentions from the specific account.
  // Note: X query syntax is space-separated terms (AND).
  const q = `from:RWSverkeersinfo ${rc} -is:retweet`;
  // Try both base URLs; some accounts/tiers behave differently.
  const urls = X_API_BASES.map((b) => {
    const u = new URL(`${b}/tweets/search/recent`);
    u.searchParams.set('query', q);
    u.searchParams.set('max_results', '5');
    u.searchParams.set('tweet.fields', 'created_at');
    return u;
  });
  try {
    let json: any | undefined;
    for (const u of urls) {
      try {
        json = await withTimeout(
          fetch(u.toString(), {
            cache: 'no-store',
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
              'user-agent': 'nl-verkeer/1.0 (+https://github.com/clawbotneo/nl-verkeer)',
            },
          }).then(async (r) => {
            if (!r.ok) {
              const body = await r.text().catch(() => '');
              throw new Error(`X API HTTP ${r.status} ${body ? `- ${body.slice(0, 200)}` : ''}`);
            }
            return (await r.json()) as any;
          }),
          5000,
          'fetchRwsExternalInfoForRoad'
        );
        break;
      } catch {
        // try next base
      }
    }

    const first = Array.isArray(json?.data) ? json.data[0] : undefined;
    const post: ExternalPost | undefined =
      first && typeof first.id === 'string' && typeof first.text === 'string'
        ? {
            id: first.id,
            text: first.text,
            createdAt: typeof first.created_at === 'string' ? first.created_at : undefined,
            url: `https://x.com/RWSverkeersinfo/status/${first.id}`,
          }
        : undefined;

    cache.set(rc, { fetchedAt: now, post });
    return post;
  } catch {
    // Don’t fail the whole API call if X is down/rate-limited.
    cache.set(rc, { fetchedAt: now, post: undefined });
    return undefined;
  }
}
