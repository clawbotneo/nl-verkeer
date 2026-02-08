/* eslint-disable @typescript-eslint/no-explicit-any */

import type { TrafficEvent } from './types';

const ANWB_FILELIJST_URL = 'https://www.anwb.nl/verkeer/filelijst';

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

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseNextDataFromHtml(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('ANWB scrape: __NEXT_DATA__ not found');
  return JSON.parse(m[1]);
}

function findTrafficListDehydratedState(nextData: any): { dehydratedState: any; dataUpdatedAt?: number } {
  const loaderData = nextData?.props?.pageProps?.loaderData;
  if (!loaderData || typeof loaderData !== 'object') throw new Error('ANWB scrape: loaderData missing');

  for (const v of Object.values(loaderData) as any[]) {
    const dehyd = v?.dehydratedState;
    const queries = asArray(dehyd?.queries);
    for (const q of queries) {
      const key = q?.queryKey;
      const data = q?.state?.data;
      if (Array.isArray(key) && key[0] === 'incidents' && key[1] === 'list' && data?.roads) {
        return { dehydratedState: dehyd, dataUpdatedAt: q?.state?.dataUpdatedAt };
      }
    }
  }

  throw new Error('ANWB scrape: traffic-list dehydratedState not found');
}

function collectSegmentsDeep(obj: any, out: any[]) {
  if (!obj) return;
  if (Array.isArray(obj)) return obj.forEach((v) => collectSegmentsDeep(v, out));
  if (typeof obj !== 'object') return;

  // Segment objects have at least: id, road, category.
  if (typeof obj.id === 'number' && typeof obj.road === 'string' && typeof obj.category === 'string') {
    out.push(obj);
    return;
  }

  for (const v of Object.values(obj)) collectSegmentsDeep(v, out);
}

function roadTypeFromSeg(seg: any): 'A' | 'N' | undefined {
  const t = String(seg?.type ?? '').toLowerCase();
  if (t === 'a') return 'A';
  if (t === 'n') return 'N';
  return undefined;
}

function roadNumberFromCode(code: string): number | undefined {
  const m = code.toUpperCase().match(/^([AN])(\d{1,3})$/);
  if (!m) return undefined;
  return Number(m[2]);
}

export async function fetchAnwbEvents(): Promise<TrafficEvent[]> {
  const html = await withTimeout(
    fetch(ANWB_FILELIJST_URL, {
      cache: 'no-store',
      headers: {
        // Be polite; some endpoints behave differently for unknown UAs.
        'user-agent': 'nl-verkeer/1.0 (+https://github.com/clawbotneo/nl-verkeer)',
        accept: 'text/html,application/xhtml+xml',
      },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`ANWB scrape: HTTP ${r.status}`);
      return await r.text();
    }),
    8000,
    'fetch anwb filelijst html'
  );

  const nextData = parseNextDataFromHtml(html);
  const { dehydratedState } = findTrafficListDehydratedState(nextData);

  const q = asArray(dehydratedState?.queries).find((x: any) => Array.isArray(x?.queryKey) && x.queryKey[0] === 'incidents');
  const roads = q?.state?.data?.roads;
  const dataUpdatedAt = q?.state?.dataUpdatedAt;

  const segments: any[] = [];
  collectSegmentsDeep(roads, segments);

  const fetchedIso = new Date(typeof dataUpdatedAt === 'number' ? dataUpdatedAt : Date.now()).toISOString();

  const out: TrafficEvent[] = [];
  for (const seg of segments) {
    const roadCode = String(seg.road ?? '').toUpperCase().replace(/\s+/g, '');
    const rt = roadTypeFromSeg(seg);
    const rn = roadNumberFromCode(roadCode);
    if (!rt || typeof rn !== 'number') continue;

    const catRaw = String(seg.category ?? '');
    const category = catRaw === 'jams' ? 'jam' : 'accident';

    const from = typeof seg.from === 'string' ? seg.from : undefined;
    const to = typeof seg.to === 'string' ? seg.to : undefined;

    // ANWB payload uses numeric distance/delay, but units vary in practice.
    // Observed: distance often in meters (e.g. 1100, 5000) and delay in seconds (e.g. 960 -> 16 minutes).
    const rawDistance = typeof seg.distance === 'number' ? seg.distance : undefined;
    const rawDelay = typeof seg.delay === 'number' ? seg.delay : undefined;

    const lengthKm =
      typeof rawDistance === 'number'
        ? // Heuristic: values > 50 are almost certainly meters, not km.
          rawDistance > 50
          ? rawDistance / 1000
          : rawDistance
        : undefined;

    const delayMin =
      typeof rawDelay === 'number'
        ? // Heuristic: values > 180 are almost certainly seconds, not minutes.
          rawDelay > 180
          ? Math.round(rawDelay / 60)
          : rawDelay
        : undefined;

    const locationText = from && to ? `${from} → ${to}` : from ?? to;

    const rawParts: string[] = [];
    if (typeof seg.reason === 'string' && seg.reason.trim()) rawParts.push(seg.reason.trim());
    for (const ev of asArray(seg.events)) {
      const txt = typeof ev?.text === 'string' ? ev.text.trim() : '';
      if (txt) rawParts.push(txt);
    }

    // Split into smaller phrases so we can dedupe "Dicht. Wegwerkzaamheden." vs "Dicht" + "Wegwerkzaamheden".
    const phrases: string[] = [];
    for (const p of rawParts) {
      for (const piece of p.split(/\.(?:\s+|$)/g)) {
        const s = piece.trim();
        if (s) phrases.push(s);
      }
    }

    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

    const uniq = new Map<string, string>();
    for (const ph of phrases) {
      const cleaned = ph.replace(/[\s\.;:,-]+$/g, '').trim();
      const k = norm(cleaned);
      if (!k) continue;
      if (!uniq.has(k)) uniq.set(k, cleaned);
    }

    const reasonText = uniq.size ? Array.from(uniq.values()).join('. ') + '.' : undefined;

    out.push({
      id: `anwb:${seg.id}`,
      roadType: rt,
      roadNumber: rn,
      roadCode,
      direction: typeof seg.codeDirection === 'number' ? String(seg.codeDirection) : undefined,
      from,
      to,
      locationText,
      lengthKm,
      delayMin,
      category,
      eventTypeRaw: `${catRaw}:${String(seg.incidentType ?? '')}`,
      reasonText,
      lastUpdated: fetchedIso,
      source: 'ANWB',
      sourceUrl: ANWB_FILELIJST_URL,
    });
  }

  return out;
}
