'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

type Lang = 'nl' | 'en';

type RoadType = 'A' | 'N' | 'ALL';

type Category = 'all' | 'jam' | 'accident';

type Sort = 'road' | 'delay' | 'length';

type TrafficEvent = {
  id: string;
  roadType: 'A' | 'N';
  roadNumber: number;
  roadCode: string;
  category: 'jam' | 'accident';
  locationText?: string;
  lengthKm?: number;
  delayMin?: number;
  lastUpdated: string;
  sourceUrl: string;
  source?: 'NDW' | 'ANWB';
  reasonText?: string;
  externalInfoText?: string;
  externalInfoUrl?: string;
  externalInfoUpdated?: string;
};

const i18n = {
  nl: {
    title: 'Verkeer (NL) — files & ongevallen',
    subtitle: 'Actuele lijst met filter en sortering. Data: ANWB (scrape) of NDW Open Data.',
    lang: 'Taal',
    roadType: 'Wegtype',
    road: 'Weg',
    category: 'Type',
    sort: 'Sorteren',
    all: 'Alles',
    aRoads: 'A-wegen',
    nRoads: 'N-wegen',
    jams: 'Files',
    accidents: 'Ongevallen',
    delay: 'Vertraging',
    length: 'Lengte',
    updated: 'Laatst bijgewerkt',
    noResults: 'Geen resultaten (met deze filters).',
    example: 'Voorbeeld: A8 of N35',
  },
  en: {
    title: 'Traffic (NL) — jams & accidents',
    subtitle: 'Live list with filters and sorting. Data: ANWB (scrape) or NDW Open Data.',
    lang: 'Language',
    roadType: 'Road type',
    road: 'Road',
    category: 'Category',
    sort: 'Sort',
    all: 'All',
    aRoads: 'A roads',
    nRoads: 'N roads',
    jams: 'Jams',
    accidents: 'Accidents',
    delay: 'Delay',
    length: 'Length',
    updated: 'Last updated',
    noResults: 'No results (with these filters).',
    example: 'Example: A8 or N35',
  },
} satisfies Record<Lang, Record<string, string>>;

function parseRoadInput(raw: string): { type?: 'A' | 'N'; road?: number } {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return {};
  const m = s.match(/^([AN])(\d{1,3})$/);
  if (!m) return {};
  return { type: m[1] as 'A' | 'N', road: Number(m[2]) };
}

function linkify(text: string): Array<string | React.ReactNode> {
  // Simple URL linkifier for X text (t.co links etc.).
  const re = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(re);
  return parts.map((p, idx) => {
    if (re.test(p)) {
      const url = p.replace(/[),.;:!?]+$/g, '');
      const trail = p.slice(url.length);
      return (
        <Fragment key={idx}>
          <a className="text-blue-600 hover:underline break-all" href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
          {trail}
        </Fragment>
      );
    }
    return p;
  });
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('nl');
  const t = i18n[lang];

  const [roadType, setRoadType] = useState<RoadType>('ALL');
  const [roadInput, setRoadInput] = useState('');
  // Default to files-only (matches the main use-case)
  const [category, setCategory] = useState<Category>('jam');
  const [sort, setSort] = useState<Sort>('road');

  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string>('');
  const [warning, setWarning] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const fetchedAtLabel = useMemo(() => {
    if (!fetchedAt) return '-';
    const d = new Date(fetchedAt);
    if (Number.isNaN(d.getTime())) return fetchedAt;
    const minsAgo = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    const local = d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${local} (${minsAgo} min geleden)`;
  }, [fetchedAt]);

  const derivedRoad = useMemo(() => parseRoadInput(roadInput), [roadInput]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('sort', sort);

    const effectiveType = derivedRoad.type ?? (roadType === 'ALL' ? undefined : roadType);
    const effectiveRoad = derivedRoad.road;

    if (effectiveType) params.set('type', effectiveType);
    if (Number.isFinite(effectiveRoad)) params.set('road', String(effectiveRoad));

    if (category !== 'all') params.set('category', category);

    return `/api/events?${params.toString()}`;
  }, [sort, derivedRoad.type, derivedRoad.road, roadType, category]);

  async function load() {
    try {
      setLoading(true);
      setError('');
      setWarning('');
      const res = await fetch(queryUrl, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'API error');
      setEvents(json.events);
      setFetchedAt(json.fetchedAt);
      if (json.warning) setWarning(String(json.warning));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryUrl]);

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto bg-gray-50 text-gray-900">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-sm text-gray-600 mt-1">{t.subtitle}</p>
        </div>

        <label className="text-sm">
          <span className="block text-gray-600 mb-1">{t.lang}</span>
          <select
            className="border rounded px-2 py-1"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="nl">NL</option>
            <option value="en">EN</option>
          </select>
        </label>
      </div>

      <section className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-4">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">{t.roadType}</span>
          <select
            className="border rounded px-2 py-1 w-full"
            value={roadType}
            onChange={(e) => setRoadType(e.target.value as RoadType)}
          >
            <option value="ALL">{t.all}</option>
            <option value="A">{t.aRoads}</option>
            <option value="N">{t.nRoads}</option>
          </select>
        </label>

        <label className="text-sm md:col-span-2">
          <span className="block text-gray-600 mb-1">{t.road}</span>
          <input
            className="border rounded px-2 py-1 w-full"
            value={roadInput}
            onChange={(e) => setRoadInput(e.target.value)}
            placeholder={t.example}
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-600 mb-1">{t.category}</span>
          <select
            className="border rounded px-2 py-1 w-full"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            <option value="all">{t.all}</option>
            <option value="jam">{t.jams}</option>
            <option value="accident">{t.accidents}</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-600 mb-1">{t.sort}</span>
          <select
            className="border rounded px-2 py-1 w-full"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="road">Weg</option>
            <option value="delay">{t.delay}</option>
            <option value="length">{t.length}</option>
          </select>
        </label>
      </section>

      <section className="mt-4 text-sm text-gray-600 flex gap-3 flex-wrap">
        <div>
          {t.updated}: <span className="font-mono">{fetchedAtLabel}</span>
        </div>
        {loading ? <div>…</div> : null}
        {warning ? <div className="text-amber-700">{warning}</div> : null}
        {error ? <div className="text-red-600">{error}</div> : null}
      </section>

      <section className="mt-6 space-y-2">
        {(() => {
          const groups = new Map<string, TrafficEvent[]>();
          for (const e of events) {
            const k = e.roadCode;
            const arr = groups.get(k);
            if (arr) arr.push(e);
            else groups.set(k, [e]);
          }

          const entries = Array.from(groups.entries());

          return entries.map(([roadCode, items]) => {
            const jamCount = items.filter((i) => i.category === 'jam').length;
            const accCount = items.length - jamCount;
            const maxDelay = Math.max(-1, ...items.map((i) => (typeof i.delayMin === 'number' ? i.delayMin : -1)));
            const maxLen = Math.max(-1, ...items.map((i) => (typeof i.lengthKm === 'number' ? i.lengthKm : -1)));

            return (
              <details key={roadCode} className="border rounded bg-white text-gray-900 shadow-sm">
                <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-3 bg-gray-100 text-gray-900">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`font-mono font-semibold px-2 py-0.5 rounded text-white ${
                        jamCount ? 'bg-red-600' : 'bg-orange-500'
                      }`}
                    >
                      {roadCode}
                    </span>
                    <span className="text-sm text-gray-600 truncate">
                      {jamCount ? `${jamCount} ${t.jams.toLowerCase()}` : ''}
                      {jamCount && accCount ? ' · ' : ''}
                      {accCount ? `${accCount} ${t.accidents.toLowerCase()}` : ''}
                    </span>
                  </div>
                  <div className="text-sm text-gray-700 flex items-center gap-4 shrink-0">
                    <span className="font-mono">{maxDelay >= 0 ? `${maxDelay} min` : '—'}</span>
                    <span className="font-mono">{maxLen >= 0 ? `${maxLen.toFixed(1)} km` : '—'}</span>
                  </div>
                </summary>

                <div className="border-t px-3 py-2 space-y-3">
                  {items.map((e) => (
                    <div key={e.id} className="rounded border bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-600">{e.category === 'jam' ? t.jams : t.accidents}</div>
                          <div className="font-medium break-words">{e.locationText || '—'}</div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-right">
                            <div className="text-gray-600">{t.delay}</div>
                            <div className="font-mono">{typeof e.delayMin === 'number' ? `${e.delayMin} min` : '—'}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-gray-600">{t.length}</div>
                            <div className="font-mono">{typeof e.lengthKm === 'number' ? `${e.lengthKm} km` : '—'}</div>
                          </div>
                        </div>
                      </div>

                      {e.reasonText ? (
                        <div className="mt-2">
                          <div className="text-xs text-gray-600">Reden</div>
                          <div className="break-words">{e.reasonText}</div>
                        </div>
                      ) : null}

                      {e.externalInfoText ? (
                        <div className="mt-2">
                          <div className="text-xs text-gray-600">Externe info</div>
                          <div className="whitespace-pre-wrap break-words">{linkify(e.externalInfoText)}</div>
                          {e.externalInfoUrl ? (
                            <a className="text-xs text-blue-600 hover:underline" href={e.externalInfoUrl} target="_blank" rel="noreferrer">
                              @RWSverkeersinfo
                            </a>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-2">
                        <a className="text-xs text-blue-600 hover:underline" href={e.sourceUrl} target="_blank" rel="noreferrer">
                          {e.source ?? 'NDW'}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            );
          });
        })()}

        {!loading && events.length === 0 ? <div className="text-sm text-gray-600">{t.noResults}</div> : null}
      </section>

      <footer className="mt-10 text-xs text-gray-500 space-y-1">
        <div>
          Data via{' '}
          <a className="underline" href="https://opendata.ndw.nu/" target="_blank" rel="noreferrer">
            opendata.ndw.nu
          </a>
          .
        </div>
      </footer>
    </main>
  );
}
