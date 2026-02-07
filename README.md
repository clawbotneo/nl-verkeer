# nl-verkeer

Repo: https://github.com/clawbotneo/nl-verkeer
Live: https://nlverkeer-f8erh2fkghcxh2ad.westeurope-01.azurewebsites.net/

Small site that lists **current Dutch traffic jams and accidents** with filters for **A-roads** and **N-roads**, plus sorting by **delay** or **length**.

## Data source

- NDW Open Data (DATEX II)
- Feeds used (gzipped XML):
  - `https://opendata.ndw.nu/actueel_beeld.xml.gz` (used for **jams** — AbnormalTraffic)
  - `https://opendata.ndw.nu/incidents.xml.gz` (used for **accidents/incidents**)

## How it works

- Frontend polls every **2 minutes**.
- Backend `/api/events` keeps an in-memory cache for **2 minutes**.
  - This avoids hammering NDW while staying near real-time.

> Note: In-memory caching is perfect for local/dev. On serverless platforms you may want a shared cache (Redis/KV) so all instances share the same 2-minute snapshot.

## Run locally

```bash
npm install
npm run dev
```

Open: http://localhost:3000

## API

`GET /api/events?type=A|N&road=8&category=jam|accident&sort=delay|length`

Examples:
- `/api/events?type=A&road=8`
- `/api/events?category=accident&sort=length`

## Next steps (easy upgrades)

- Parse more fields from DATEX (direction, from/to, better delay/length extraction).
- Add a provider abstraction to optionally support other sources.
- Add shared cache (Redis/KV) + scheduled ingest.
- Add a small allowlist of road numbers for autocomplete.
