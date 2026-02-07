import { XMLParser } from 'fast-xml-parser';
import type { TrafficEvent, EventCategory } from './types';

const NDW_OPEN_DATA_BASE = 'https://opendata.ndw.nu';

function xmlParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    // DATEX payloads can be huge; avoid aggressive value parsing.
    parseTagValue: false,
    parseAttributeValue: false,
  });
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pickFirstText(node: any): string | undefined {
  // Many DATEX fields use: { values: { value: [{ '#text': 'A65', '@_lang': 'nl' }, ...]}}
  const values = node?.values?.value;
  const arr = asArray(values);
  const first = arr[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    return first['#text'] ?? first['text'] ?? first;
  }
  return undefined;
}

function parseRoadCodeFromSituationRecord(sr: any): string | undefined {
  // Most useful: groupOfLocations ... roadsideReferencePoint ... roadName
  const roadName =
    pickFirstText(
      sr?.groupOfLocations?.roadsideReferencePoint?.roadName ??
        sr?.groupOfLocations?.roadsideReferencePoint?.pointExtension?.roadName
    ) ??
    pickFirstText(sr?.groupOfLocations?.locationContainedInGroup?.roadName);

  if (roadName && /^(A|N)\d+$/i.test(roadName.trim())) return roadName.trim().toUpperCase();

  // Fallback: sometimes road name appears in comments
  const comment = pickFirstText(sr?.generalPublicComment?.comment);
  const m = comment?.match(/\b([AN]\s?\d{1,3})\b/i);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();

  return undefined;
}

function categoryFromType(typeRaw: string, feedHint: 'incidents' | 'actueel_beeld'): EventCategory {
  if (feedHint === 'actueel_beeld') return 'jam';
  // incidents feed includes more than accidents; we map everything to "accident" bucket for MVP
  if (/Accident/i.test(typeRaw)) return 'accident';
  return 'accident';
}

function parseLengthKm(sr: any): number | undefined {
  // DATEX has multiple possible fields; we do best-effort.
  const meters =
    sr?.lengthAffected?.distance ??
    sr?.distanceAffected?.distance ??
    sr?.queueLength?.distance ??
    sr?.trafficJamLength?.distance;
  const n = typeof meters === 'string' ? Number(meters) : typeof meters === 'number' ? meters : undefined;
  if (!n || !Number.isFinite(n)) return undefined;
  return Math.round((n / 1000) * 10) / 10;
}

function parseDelayMin(sr: any): number | undefined {
  const seconds = sr?.delayTime?.duration ?? sr?.delay?.duration;
  // duration often is ISO8601 like PT6M or PT120S
  if (typeof seconds === 'number') return Math.round(seconds / 60);
  if (typeof seconds === 'string') {
    const m = seconds.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return undefined;
    const h = Number(m[1] ?? 0);
    const min = Number(m[2] ?? 0);
    const s = Number(m[3] ?? 0);
    const total = h * 60 + min + Math.round(s / 60);
    return total || undefined;
  }
  return undefined;
}

function safeIso(ts: any): string {
  if (typeof ts === 'string' && ts.length >= 10) return ts;
  return new Date().toISOString();
}

export async function fetchNdwEvents(): Promise<TrafficEvent[]> {
  const [jams, incidents] = await Promise.all([
    fetchNdwDatexFeed('actueel_beeld.xml.gz', 'actueel_beeld'),
    fetchNdwDatexFeed('incidents.xml.gz', 'incidents'),
  ]);
  return [...jams, ...incidents];
}

async function fetchNdwDatexFeed(
  path: string,
  feedHint: 'incidents' | 'actueel_beeld'
): Promise<TrafficEvent[]> {
  const url = `${NDW_OPEN_DATA_BASE}/${path}`;
  const res = await fetch(url, {
    // Allow Next.js route handlers to cache/revalidate separately; we do our own cache.
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch NDW feed ${path}: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import('node:zlib');
  const xml = gunzipSync(buf).toString('utf8');

  const parser = xmlParser();
  const doc = parser.parse(xml);

  // SOAP envelope sometimes present
  const logicalModel =
    doc?.Envelope?.Body?.d2LogicalModel ??
    doc?.['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel ??
    doc?.['SOAP:Envelope']?.['SOAP:Body']?.['d2LogicalModel'] ??
    doc?.d2LogicalModel;

  const payloadPublication = logicalModel?.payloadPublication;
  const publicationTime = safeIso(payloadPublication?.publicationTime);

  const situations = asArray(payloadPublication?.situation);

  const out: TrafficEvent[] = [];

  for (const sit of situations) {
    const sitId = sit?.['@_id'] ?? sit?.id ?? 'unknown';
    const records = asArray(sit?.situationRecord);

    for (const sr of records) {
      const typeRaw = sr?.['@_xsi:type'] ?? sr?.['@_type'] ?? sr?.['@_xsi:type'] ?? sr?.type ?? '';

      // For jams feed, only keep AbnormalTraffic records
      if (feedHint === 'actueel_beeld' && !/AbnormalTraffic/i.test(String(typeRaw))) continue;

      const roadCode = parseRoadCodeFromSituationRecord(sr);
      if (!roadCode) continue;

      const roadType = roadCode.startsWith('A') ? 'A' : 'N';
      const roadNumber = Number(roadCode.slice(1));
      if (!Number.isFinite(roadNumber)) continue;

      const category = categoryFromType(String(typeRaw), feedHint);

      const id = `NDW:${feedHint}:${sitId}:${sr?.['@_id'] ?? ''}`;

      out.push({
        id,
        roadType,
        roadNumber,
        roadCode,
        category,
        eventTypeRaw: String(typeRaw || ''),
        locationText: pickFirstText(sr?.generalPublicComment?.comment) ?? pickFirstText(sr?.nonGeneralPublicComment?.comment),
        lengthKm: parseLengthKm(sr),
        delayMin: parseDelayMin(sr),
        lastUpdated: publicationTime,
        source: 'NDW',
        sourceUrl: url,
      });
    }
  }

  return out;
}
