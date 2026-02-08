'use client';

import { useEffect, useMemo, useState } from 'react';

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
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
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

      <section className="mt-6">
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Weg</th>
                <th className="text-left p-2">{t.category}</th>
                <th className="text-right p-2">{t.delay}</th>
                <th className="text-right p-2">{t.length}</th>
                <th className="text-left p-2">Info</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const groups = new Map<string, TrafficEvent[]>();
                for (const e of events) {
                  const k = e.roadCode;
                  const arr = groups.get(k);
                  if (arr) arr.push(e);
                  else groups.set(k, [e]);
                }

                return Array.from(groups.entries()).flatMap(([roadCode, items]) =>
                  items.map((e, idx) => (
                    <tr key={e.id} className="border-t">
                      {idx === 0 ? (
                        <td className="p-2 font-mono align-top" rowSpan={items.length}>
                          {roadCode}
                        </td>
                      ) : null}
                      <td className="p-2">{e.category === 'jam' ? t.jams : t.accidents}</td>
                      <td className="p-2 text-right font-mono">
                        {typeof e.delayMin === 'number' ? `${e.delayMin} min` : '—'}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {typeof e.lengthKm === 'number' ? `${e.lengthKm} km` : '—'}
                      </td>
                      <td className="p-2">
                        <div className="line-clamp-2">{e.locationText || '—'}</div>
                        <a
                          className="text-xs text-blue-600 hover:underline"
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {e.source ?? 'NDW'}
                        </a>
                      </td>
                    </tr>
                  ))
                );
              })()}

              {!loading && events.length === 0 ? (
                <tr>
                  <td className="p-3 text-gray-600" colSpan={5}>
                    {t.noResults}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 text-xs text-gray-500 space-y-1">
        <div>
          Data via ANWB (scrape) of <a className="underline" href="https://opendata.ndw.nu/" target="_blank" rel="noreferrer">opendata.ndw.nu</a>. 
        </div>
        <div>
          Live: <a className="underline" href="https://nlverkeer-f8erh2fkghcxh2ad.westeurope-01.azurewebsites.net/" target="_blank" rel="noreferrer">
            nlverkeer-f8erh2fkghcxh2ad.westeurope-01.azurewebsites.net
          </a>
        </div>
      </footer>
    </main>
  );
}
