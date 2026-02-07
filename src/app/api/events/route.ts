import { NextResponse } from 'next/server';
import { fetchNdwEvents } from '@/lib/ndw';
import type { EventsQuery, TrafficEvent } from '@/lib/types';

type Cache = {
  fetchedAt: number;
  events: TrafficEvent[];
};

const CACHE_TTL_MS = 2 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
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
    sort: sort === 'delay' || sort === 'length' ? sort : undefined,
  };
}

function applyFilterSort(events: TrafficEvent[], q: EventsQuery): TrafficEvent[] {
  let out = events;
  if (q.type) out = out.filter((e) => e.roadType === q.type);
  if (Number.isFinite(q.road)) out = out.filter((e) => e.roadNumber === q.road);
  if (q.category) out = out.filter((e) => e.category === q.category);

  const sortKey = q.sort ?? 'delay';
  out = [...out].sort((a, b) => {
    const av = sortKey === 'delay' ? a.delayMin : a.lengthKm;
    const bv = sortKey === 'delay' ? b.delayMin : b.lengthKm;
    const an = typeof av === 'number' ? av : -1;
    const bn = typeof bv === 'number' ? bv : -1;
    return bn - an;
  });

  return out;
}

async function getEventsFresh(): Promise<Cache> {
  const now = Date.now();
  const cache = globalThis.__nlVerkeerCache;
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const events = await fetchNdwEvents();
  const next: Cache = { fetchedAt: now, events };
  globalThis.__nlVerkeerCache = next;
  return next;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = parseQuery(url);

  try {
    const cache = await getEventsFresh();
    const filtered = applyFilterSort(cache.events, q);

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      count: filtered.length,
      events: filtered,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? 'Unknown error',
      },
      { status: 500 }
    );
  }
}
