'use client';

import { useEffect, useMemo, useState } from 'react';

type Lang = 'nl' | 'en';

type RoadType = 'A' | 'N' | 'ALL';

type Category = 'all' | 'jam' | 'accident';

type Sort = 'delay' | 'length';

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
};

const i18n = {
  nl: {
    title: 'Verkeer (NL) — files & ongevallen',
    subtitle: 'Actuele lijst met filter en sortering. Data: NDW Open Data.',
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
    subtitle: 'Live list with filters and sorting. Data: NDW Open Data.',
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
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<Sort>('delay');

  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const derivedRoad = useMemo(() => parseRoadInput(roadInput), [roadInput]);

  const queryUrl = useMemo(() => {
    const url = new URL('/api/events', window.location.origin);
    url.searchParams.set('sort', sort);

    const effectiveType = derivedRoad.type ?? (roadType === 'ALL' ? undefined : roadType);
    const effectiveRoad = derivedRoad.road;

    if (effectiveType) url.searchParams.set('type', effectiveType);
    if (Number.isFinite(effectiveRoad)) url.searchParams.set('road', String(effectiveRoad));

    if (category !== 'all') url.searchParams.set('category', category);

    return url.toString();
  }, [sort, derivedRoad.type, derivedRoad.road, roadType, category]);

  async function load() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(queryUrl, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'API error');
      setEvents(json.events);
      setFetchedAt(json.fetchedAt);
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
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
            <option value="delay">{t.delay}</option>
            <option value="length">{t.length}</option>
          </select>
        </label>
      </section>

      <section className="mt-4 text-sm text-gray-600 flex gap-3 flex-wrap">
        <div>
          {t.updated}: <span className="font-mono">{fetchedAt || '-'}</span>
        </div>
        {loading ? <div>…</div> : null}
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
              {events.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2 font-mono">{e.roadCode}</td>
                  <td className="p-2">
                    {e.category === 'jam' ? t.jams : t.accidents}
                  </td>
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
                      NDW
                    </a>
                  </td>
                </tr>
              ))}

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

      <footer className="mt-10 text-xs text-gray-500">
        <div>
          Data via <a className="underline" href="https://opendata.ndw.nu/" target="_blank" rel="noreferrer">opendata.ndw.nu</a>.
        </div>
      </footer>
    </main>
  );
}
