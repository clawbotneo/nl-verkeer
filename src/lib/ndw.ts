/* eslint-disable @typescript-eslint/no-explicit-any */

import { XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { DBFFile } from 'dbffile';
import sax from 'sax';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import type { TrafficEvent, EventCategory } from './types';

const NDW_OPEN_DATA_BASE = 'https://opendata.ndw.nu';
const VILD_ZIP_NAME = 'VILD6.13.A.zip';

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

type VildCache = {
  fetchedAt: number;
  roadBySpecificLocation: Map<number, string>; // e.g. 7200 -> "A10"
};

declare global {
  var __nlVerkeerVildCache: VildCache | undefined;
}

const VILD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function asNumber(v: any): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function extractZipEntryToFile(zipPath: string, entryName: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Failed to open zip'));

      let done = false;
      zip.readEntry();
      zip.on('entry', (e) => {
        if (done) return;
        if (e.fileName === entryName) {
          zip.openReadStream(e, (err, rs) => {
            if (err || !rs) return reject(err ?? new Error('Failed to open zip entry stream'));
            const ws = fs.createWriteStream(outPath);
            rs.pipe(ws);
            ws.on('finish', () => {
              done = true;
              resolve();
            });
            ws.on('error', reject);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!done) reject(new Error(`Zip entry not found: ${entryName}`));
      });
    });
  });
}

async function getVildRoadMap(): Promise<Map<number, string>> {
  const now = Date.now();
  const cached = globalThis.__nlVerkeerVildCache;
  if (cached && now - cached.fetchedAt < VILD_CACHE_TTL_MS) return cached.roadBySpecificLocation;

  // Download VILD location table zip (Alert-C). We parse the DBF for road numbers.
  const zipUrl = `${NDW_OPEN_DATA_BASE}/${VILD_ZIP_NAME}`;
  const res = await fetch(zipUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${VILD_ZIP_NAME}: ${res.status}`);

  const tmpDir = path.join(os.tmpdir(), 'nl-verkeer');
  fs.mkdirSync(tmpDir, { recursive: true });

  const zipPath = path.join(tmpDir, VILD_ZIP_NAME);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

  const dbfName = 'VILD6.13.A.dbf';
  const dbfPath = path.join(tmpDir, dbfName);
  await extractZipEntryToFile(zipPath, dbfName, dbfPath);

  const dbf = await DBFFile.open(dbfPath);
  const map = new Map<number, string>();

  // Read all records; recordCount ~12k so this is fine.
  let remaining = dbf.recordCount;
  while (remaining > 0) {
    const chunk = await dbf.readRecords(Math.min(5000, remaining));
    remaining -= chunk.length;
    for (const r of chunk as any[]) {
      const loc = asNumber(r.LOC_NR);
      const road = typeof r.ROADNUMBER === 'string' ? r.ROADNUMBER.trim().toUpperCase().replace(/\s+/g, '') : '';
      if (loc && road && /^(A|N)\d{1,3}$/i.test(road)) {
        map.set(loc, road);
      }
    }
  }

  globalThis.__nlVerkeerVildCache = { fetchedAt: now, roadBySpecificLocation: map };
  return map;
}

function collectSpecificLocationsDeep(obj: any): number[] {
  const out: number[] = [];
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur !== 'object') continue;

    if ('specificLocation' in cur) {
      const n = asNumber((cur as any).specificLocation);
      if (typeof n === 'number') out.push(n);
    }

    for (const v of Object.values(cur)) {
      if (!v) continue;
      if (typeof v === 'object') stack.push(v);
    }
  }
  return out;
}

async function parseRoadCodeFromSituationRecord(sr: any): Promise<string | undefined> {
  // Try direct road name fields (older feeds)
  const roadName =
    pickFirstText(
      sr?.groupOfLocations?.roadsideReferencePoint?.roadName ??
        sr?.groupOfLocations?.roadsideReferencePoint?.pointExtension?.roadName
    ) ??
    pickFirstText(sr?.groupOfLocations?.locationContainedInGroup?.roadName);

  if (roadName && /^(A|N)\d+$/i.test(roadName.trim())) return roadName.trim().toUpperCase();

  // Sometimes road name appears in comments
  const comment = pickFirstText(sr?.generalPublicComment?.comment);
  const m = comment?.match(/\b([AN]\s?\d{1,3})\b/i);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();

  // DATEX feeds increasingly use Alert-C / specificLocation references. Map those via VILD.
  const specificLocations = collectSpecificLocationsDeep(sr?.locationReference ?? sr?.groupOfLocations);
  if (specificLocations.length) {
    const roadMap = await getVildRoadMap();
    for (const loc of specificLocations) {
      const road = roadMap.get(loc);
      if (road) return road;
    }
  }

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
    sr?.trafficJamLength?.distance ??
    sr?.queueLength;

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
  const [measuredJams, incidents] = await Promise.all([
    // Prefer measured travel time: yields actual delay minutes.
    fetchNdwMeasuredJamsFromTravelTime().catch(() => []),
    fetchNdwDatexFeed('incidents.xml.gz', 'incidents'),
  ]);
  return [...measuredJams, ...incidents];
}

type MeasurementSiteCache = {
  fetchedAt: number;
  // measurementSiteReference id -> { roadCode, name }
  sites: Map<string, { roadCode?: string; name?: string }>;
};

declare global {
  var __nlVerkeerMeasurementSiteCache: MeasurementSiteCache | undefined;
}

const MEASUREMENT_SITE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function roundTo5Min(n: number): number {
  return Math.round(n / 5) * 5;
}

function guessLengthKmFromReference(roadCode: string, refSeconds: number): number {
  // crude but ok for MVP: assume freeflow speed
  const isA = roadCode.startsWith('A');
  const kmh = isA ? 100 : 80;
  const km = (refSeconds / 3600) * kmh;
  return Math.max(0.1, Math.round(km * 10) / 10);
}

async function getMeasurementSitesFor(ids: Set<string>): Promise<Map<string, { roadCode?: string; name?: string }>> {
  const now = Date.now();
  const cached = globalThis.__nlVerkeerMeasurementSiteCache;
  if (cached && now - cached.fetchedAt < MEASUREMENT_SITE_CACHE_TTL_MS) {
    return cached.sites;
  }

  // If we don't need any ids, short-circuit.
  if (ids.size === 0) {
    const sites = new Map<string, { roadCode?: string; name?: string }>();
    globalThis.__nlVerkeerMeasurementSiteCache = { fetchedAt: now, sites };
    return sites;
  }

  const url = `${NDW_OPEN_DATA_BASE}/measurement_current.xml.gz`;

  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch measurement_current.xml.gz: ${res.status}`);
      break;
    } catch (e) {
      lastErr = e;
      // small backoff
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (!res) throw lastErr ?? new Error('Failed to fetch measurement_current.xml.gz');

  const vildRoadMap = await getVildRoadMap();

  const sites = new Map<string, { roadCode?: string; name?: string }>();
  const remaining = new Set(ids);

  // Stream-parse the huge XML. We only keep entries we care about, and stop early when done.
  const parser = sax.parser(false, { lowercase: true });
  let currentId: string | null = null;
  let inWanted = false;
  let text = '';
  const stack: string[] = [];

  function curPath() {
    return stack.join('/');
  }

  let currentName: string | undefined;
  let specificLoc: number | undefined;

  parser.onopentag = (node: any) => {
    stack.push(node.name);
    text = '';

    if (node.name === 'measurementsiterecord') {
      const id = node.attributes?.id;
      currentId = typeof id === 'string' ? id : null;
      inWanted = !!currentId && ids.has(currentId);
      currentName = undefined;
      specificLoc = undefined;
    }
  };

  parser.ontext = (t: string) => {
    if (inWanted) text += t;
  };

  parser.onclosetag = (name: string) => {
    if (inWanted) {
      const p = curPath();
      const val = text.trim();

      if (val) {
        if (p.endsWith('measurementsitename/values/value')) {
          currentName = val;
        }
        if (p.endsWith('alertcpoint/alertcmethod2primarypointlocation/alertclocation/specificlocation')) {
          const n = Number(val);
          if (Number.isFinite(n)) specificLoc = n;
        }
      }

      if (name === 'measurementsiterecord' && currentId) {
        const roadCode = typeof specificLoc === 'number' ? vildRoadMap.get(specificLoc) : undefined;
        sites.set(currentId, { roadCode, name: currentName });
        remaining.delete(currentId);
      }
    }

    if (name === 'measurementsiterecord') {
      currentId = null;
      inWanted = false;
      currentName = undefined;
      specificLoc = undefined;
    }

    stack.pop();
    text = '';
  };

  // Pipe response through gunzip into sax.
  await new Promise<void>((resolve, reject) => {
    const gunzip = zlib.createGunzip();

    const finish = () => {
      try {
        gunzip.removeAllListeners();
      } catch {}
      resolve();
    };

    gunzip.on('data', (chunk) => {
      try {
        parser.write(chunk.toString('utf8'));
        if (remaining.size === 0) {
          // We found all requested ids; stop parsing early.
          gunzip.destroy();
          finish();
        }
      } catch (e) {
        reject(e);
      }
    });
    gunzip.on('end', () => resolve());
    gunzip.on('error', (e) => {
      // If we destroyed intentionally (early stop), ignore.
      if ((e as any)?.code === 'ERR_STREAM_PREMATURE_CLOSE' && remaining.size === 0) return resolve();
      reject(e);
    });

    const webStream = res.body as any;
    if (!webStream) return reject(new Error('No response body'));
    const nodeStream = Readable.fromWeb(webStream);
    nodeStream.on('error', reject);
    nodeStream.pipe(gunzip);
  });

  globalThis.__nlVerkeerMeasurementSiteCache = { fetchedAt: now, sites };
  return sites;
}

async function fetchNdwMeasuredJamsFromTravelTime(): Promise<TrafficEvent[]> {
  const pathName = 'traveltime.xml.gz';
  const url = `${NDW_OPEN_DATA_BASE}/${pathName}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch NDW feed ${pathName}: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const xml = zlib.gunzipSync(buf).toString('utf8');
  const parser = xmlParser();
  const doc = parser.parse(xml);

  const pp = doc?.Envelope?.Body?.d2LogicalModel?.payloadPublication;
  const publicationTime = safeIso(pp?.publicationTime);
  const siteMeasurements = asArray(pp?.siteMeasurements);

  // First pass: compute delays and keep only the sites that qualify as "file".
  type JamCandidate = {
    siteId: string;
    curDur: number;
    refDur: number;
    delayMin: number;
  };

  const candidates: JamCandidate[] = [];
  const wantedIds = new Set<string>();

  const MAX_JAMS = 200; // cap work + UI noise

  for (const sm of siteMeasurements) {
    const siteId = sm?.measurementSiteReference?.['@_id'];
    if (typeof siteId !== 'string') continue;

    const mv = asArray(sm?.measuredValue)?.[0]?.measuredValue;
    const basic = mv?.basicData;
    if (!basic) continue;

    const curDur = Number(basic?.travelTime?.duration);
    const refDur = Number(
      mv?.measuredValueExtension?.measuredValueExtended?.basicDataReferenceValue?.travelTimeData?.travelTime?.duration
    );

    if (!Number.isFinite(curDur) || !Number.isFinite(refDur)) continue;

    const delayMinRaw = (curDur - refDur) / 60;
    if (!Number.isFinite(delayMinRaw)) continue;

    const delayMin = roundTo5Min(delayMinRaw);
    if (delayMin < 5) continue;

    candidates.push({ siteId, curDur, refDur, delayMin });
  }

  // Only resolve + return the top N jams by delay (keeps measurement_current lookup fast).
  candidates.sort((a, b) => b.delayMin - a.delayMin);
  const top = candidates.slice(0, MAX_JAMS);
  for (const c of top) wantedIds.add(c.siteId);

  const siteInfo = await getMeasurementSitesFor(wantedIds);

  const out: TrafficEvent[] = [];

  for (const c of top) {
    const info = siteInfo.get(c.siteId);
    const roadCode = info?.roadCode;
    if (!roadCode) continue;

    const delayMin = c.delayMin;
    const refDur = c.refDur;

    const roadType = roadCode.startsWith('A') ? 'A' : 'N';
    const roadNumber = Number(roadCode.slice(1));
    if (!Number.isFinite(roadNumber)) continue;

    const lengthKm = guessLengthKmFromReference(roadCode, refDur);

    out.push({
      id: `NDW:traveltime:${c.siteId}`,
      roadType,
      roadNumber,
      roadCode,
      category: 'jam',
      eventTypeRaw: 'MeasuredTravelTime',
      locationText: info?.name,
      lengthKm,
      delayMin,
      lastUpdated: publicationTime,
      source: 'NDW',
      sourceUrl: url,
    });
  }

  return out;
}

async function fetchNdwDatexFeed(
  pathName: string,
  feedHint: 'incidents' | 'actueel_beeld'
): Promise<TrafficEvent[]> {
  const url = `${NDW_OPEN_DATA_BASE}/${pathName}`;
  const res = await fetch(url, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch NDW feed ${pathName}: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import('node:zlib');
  const xml = gunzipSync(buf).toString('utf8');

  const parser = xmlParser();
  const doc = parser.parse(xml);

  // NDW is migrating away from DATEX II v2 SOAP. We support:
  // - DATEX II v2 (SOAP Envelope -> d2LogicalModel -> payloadPublication)
  // - DATEX II v3 messageContainer (messageContainer.payload)
  const v2PayloadPublication = doc?.Envelope?.Body?.d2LogicalModel?.payloadPublication;
  const v3Payload = doc?.messageContainer?.payload;

  const publicationTime = safeIso(v2PayloadPublication?.publicationTime ?? v3Payload?.publicationTime);
  const situations = asArray(v2PayloadPublication?.situation ?? v3Payload?.situation);

  const out: TrafficEvent[] = [];

  for (const sit of situations) {
    const sitId = sit?.['@_id'] ?? sit?.['@_id'] ?? sit?.id ?? 'unknown';
    const records = asArray(sit?.situationRecord);

    for (const sr of records) {
      const typeRaw = sr?.['@_xsi:type'] ?? sr?.['@_type'] ?? sr?.['@_type'] ?? sr?.type ?? '';

      // For the "actueel beeld" feed, we only want real queues/jams.
      if (feedHint === 'actueel_beeld' && !/AbnormalTraffic/i.test(String(typeRaw))) continue;

      const roadCode = await parseRoadCodeFromSituationRecord(sr);
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
        locationText:
          pickFirstText(sr?.generalPublicComment?.comment) ??
          pickFirstText(sr?.nonGeneralPublicComment?.comment) ??
          pickFirstText(sr?.cause?.causeDescription),
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
