'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type TrafficEvent = {
  id: string;
  roadCode: string;
  category: 'jam' | 'accident';
  lengthKm?: number;
  delayMin?: number;
  locationText?: string;
  sourceUrl: string;
};

export default function RoadPage({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase().replace(/\s+/g, '');
  const m = code.match(/^([AN])(\d{1,3})$/);
  const type = m?.[1];
  const road = m?.[2];

  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string>('');
  const [error, setError] = useState<string>('');

  const queryUrl = useMemo(() => {
    const url = new URL('/api/events', window.location.origin);
    url.searchParams.set('sort', 'delay');
    if (type) url.searchParams.set('type', type);
    if (road) url.searchParams.set('road', road);
    return url.toString();
  }, [type, road]);

  useEffect(() => {
    async function load() {
      try {
        setError('');
        const res = await fetch(queryUrl, { cache: 'no-store' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'API error');
        setEvents(json.events);
        setFetchedAt(json.fetchedAt);
      } catch (e: any) {
        setError(e?.message ?? 'Unknown error');
      }
    }

    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [queryUrl]);

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{code}</h1>
        <Link className="text-sm text-blue-600 hover:underline" href="/">← Terug</Link>
      </div>

      <div className="mt-2 text-sm text-gray-600">Laatst bijgewerkt: <span className="font-mono">{fetchedAt || '-'}</span></div>
      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      <div className="mt-6 overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Type</th>
              <th className="text-right p-2">Vertraging</th>
              <th className="text-right p-2">Lengte</th>
              <th className="text-left p-2">Info</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2">{e.category === 'jam' ? 'File' : 'Ongeval'}</td>
                <td className="p-2 text-right font-mono">{typeof e.delayMin === 'number' ? `${e.delayMin} min` : '—'}</td>
                <td className="p-2 text-right font-mono">{typeof e.lengthKm === 'number' ? `${e.lengthKm} km` : '—'}</td>
                <td className="p-2">
                  <div className="line-clamp-2">{e.locationText || '—'}</div>
                  <a className="text-xs text-blue-600 hover:underline" href={e.sourceUrl} target="_blank" rel="noreferrer">NDW</a>
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr><td className="p-3 text-gray-600" colSpan={4}>Geen meldingen op dit moment.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
