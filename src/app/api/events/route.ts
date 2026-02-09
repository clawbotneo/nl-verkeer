import { NextResponse } from 'next/server';
import { fetchNdwEvents } from '@/lib/ndw';
import { fetchAnwbEvents } from '@/lib/anwb';
import { fetchRwsExternalInfoForRoad, getXLastError } from '@/lib/x';
import type { EventsQuery, TrafficEvent } from '@/lib/types';

type Cache = {
  fetchedAt: number;
  events: TrafficEvent[];
};

const CACHE_TTL_MS = 2 * 60 * 1000;

declare global {
  var __nlVerkeerCache: Cache | undefined;
}

function parseQuery(url: URL): EventsQuery {
  const type = url.searchParams.get('type')?.toUpperCase();
  const roadStr = url.searchParams.get('road');
  const category = url.searchParams.get('category');
  const sort = url.searchParams.get('sort');

  return {
    type: type === 'A' || type === 'N' ? type : undefined,
    road: roadStr ? Number(roadStr) : undefined,
    category: category === 'jam' || category === 'accident' ? category : undefined,
    sort: sort === 'delay' || sort === 'length' || sort === 'road' ? sort : undefined,
  };
}

function applyFilterSort(events: TrafficEvent[], q: EventsQuery): TrafficEvent[] {
  let out = events;
  if (q.type) out = out.filter((e) => e.roadType === q.type);
  if (Number.isFinite(q.road)) out = out.filter((e) => e.roadNumber === q.road);
  if (q.category) out = out.filter((e) => e.category === q.category);

  const sortKey = q.sort ?? 'delay';
  out = [...out].sort((a, b) => {
    if (sortKey === 'road') {
      if (a.roadType !== b.roadType) return a.roadType === 'A' ? -1 : 1;
      if (a.roadNumber !== b.roadNumber) return a.roadNumber - b.roadNumber;
      // Within a road: show bigger delays first, then longer.
      const ad = typeof a.delayMin === 'number' ? a.delayMin : -1;
      const bd = typeof b.delayMin === 'number' ? b.delayMin : -1;
      if (ad !== bd) return bd - ad;
      const al = typeof a.lengthKm === 'number' ? a.lengthKm : -1;
      const bl = typeof b.lengthKm === 'number' ? b.lengthKm : -1;
      return bl - al;
    }

    const av = sortKey === 'delay' ? a.delayMin : a.lengthKm;
    const bv = sortKey === 'delay' ? b.delayMin : b.lengthKm;
    const an = typeof av === 'number' ? av : -1;
    const bn = typeof bv === 'number' ? bv : -1;
    return bn - an;
  });

  return out;
}

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

async function getEventsFresh(): Promise<{ cache: Cache; stale: boolean; warning?: string }> {
  const now = Date.now();
  const cache = globalThis.__nlVerkeerCache;
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return { cache, stale: false };

  const preferred = (process.env.NL_VERKEER_SOURCE ?? 'NDW').toUpperCase();

  async function load(): Promise<TrafficEvent[]> {
    if (preferred === 'ANWB') {
      // Scrape ANWB (best fidelity) but keep a fallback.
      try {
        return await withTimeout(fetchAnwbEvents(), 8000, 'fetchAnwbEvents');
      } catch {
        return await withTimeout(fetchNdwEvents(), 8000, 'fetchNdwEvents(fallback)');
      }
    }

    // Default: NDW open data.
    return await withTimeout(fetchNdwEvents(), 8000, 'fetchNdwEvents');
  }

  try {
    let events = await load();

    // Optional enrichment: add latest matching @RWSverkeersinfo post per roadCode.
    // Only do X calls when there is at least one *file* (jam) in the current dataset.
    if (process.env.X_BEARER_TOKEN && events.some((e) => e.category === 'jam')) {
      const roadCodes = Array.from(new Set(events.filter((e) => e.category === 'jam').map((e) => e.roadCode)));
      const posts = await Promise.all(roadCodes.map(async (rc) => ({ rc, post: await fetchRwsExternalInfoForRoad(rc) })));
      const byRoad = new Map(posts.filter((p) => p.post).map((p) => [p.rc, p.post!]));
      if (byRoad.size) {
        events = events.map((e) => {
          // Enrich only jam rows (as requested)
          if (e.category !== 'jam') return e;
          const p = byRoad.get(e.roadCode);
          if (!p) return e;
          return {
            ...e,
            externalInfoText: p.text,
            externalInfoUrl: p.url,
            externalInfoUpdated: p.createdAt ?? new Date(now).toISOString(),
          };
        });
      }
    }

    const next: Cache = { fetchedAt: now, events };
    globalThis.__nlVerkeerCache = next;
    return { cache: next, stale: false };
  } catch (e: unknown) {
    // Fallback: serve last known data (even if stale) instead of timing out.
    if (cache) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { cache, stale: true, warning: `Serving stale data: ${msg}` };
    }
    throw e;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = parseQuery(url);
  const xdebug = url.searchParams.get('xdebug') === '1';

  try {
    const { cache, stale, warning } = await getEventsFresh();
    const filtered = applyFilterSort(cache.events, q);

    const xLast = xdebug ? getXLastError() : undefined;

    return NextResponse.json({
      ok: true,
      stale,
      warning,
      xDebug: xLast,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      count: filtered.length,
      events: filtered,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
