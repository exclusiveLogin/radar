> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.`n`n# ADR-007: Р¤РѕРЅРѕРІР°СЏ СЃР±РѕСЂРєР° РіСЂР°С„Р° С‚СЂР°РµРєС‚РѕСЂРёР№ (Kalman worker)

Р”Р°С‚Р°: 2026-06-12  
РЎС‚Р°С‚СѓСЃ: **РџСЂРµРґР»РѕР¶РµРЅРѕ**

РЎРІСЏР·Р°РЅРѕ: [ADR-008](./adr-008-kinematic-vs-static-events.md), [ADR-009](./adr-009-osint-pre-collapse.md), [roadmap](./roadmap-tracking-forecasting.md)

---

## РљРѕРЅС‚РµРєСЃС‚

OSINT-РїРѕС‚РѕРє РґР°С‘С‚ РґРѕ ~150k РіРµРѕС‚РѕС‡РµРє Р±РµР· СЃС‚Р°Р±РёР»СЊРЅС‹С… object ID (Р±РѕСЂС‚РѕРІС‹С… РЅРѕРјРµСЂРѕРІ). РўРѕС‡РєРё РїСЂРёС…РѕРґСЏС‚ РёР· СЂР°Р·РЅС‹С… Telegram-РєР°РЅР°Р»РѕРІ СЃ СЂР°Р·РЅС‹Рј lag Рё С‚РѕС‡РЅРѕСЃС‚СЊСЋ. Operational fold ([ADR-006](./adr-006-map-read-line-fold.md)) РѕС‚РІРµС‡Р°РµС‚ РЅР° РІРѕРїСЂРѕСЃ В«РєР°РєРѕР№ СЃС‚Р°С‚СѓСЃ СЂРµРіРёРѕРЅР° СЃРµР№С‡Р°СЃВ», РЅРѕ РЅРµ СЃС‚СЂРѕРёС‚ РЅРµРїСЂРµСЂС‹РІРЅС‹Рµ С‚СЂР°РµРєС‚РѕСЂРёРё РґРІРёР¶СѓС‰РёС…СЃСЏ С†РµР»РµР№.

РџСЂРѕР±Р»РµРјС‹ Р±РµР· tracking-РґРѕРјРµРЅР°:

- Р СѓС‡РЅР°СЏ СЂР°Р·РјРµС‚РєР° В«СЌС‚Рѕ РѕРґРЅР° Рё С‚Р° Р¶Рµ С†РµР»СЊВ» РЅРµ РјР°СЃС€С‚Р°Р±РёСЂСѓРµС‚СЃСЏ.
- РЎРєРѕСЂРѕСЃС‚СЊ Рё РєСѓСЂСЃ РЅРµР»СЊР·СЏ РІС‹С‡РёСЃР»РёС‚СЊ РёР· РѕРґРёРЅРѕС‡РЅС‹С… С‚РѕС‡РµРє Р±РµР· РјРѕРґРµР»Рё РґРІРёР¶РµРЅРёСЏ.
- РџСЂРѕРіРЅРѕР· В«РіРґРµ С†РµР»СЊ СЃРµР№С‡Р°СЃВ» РЅРµРІРѕР·РјРѕР¶РµРЅ РїСЂРё РїР°СѓР·Рµ РІ РЅР°Р±Р»СЋРґРµРЅРёСЏС….

---

## Р РµС€РµРЅРёРµ

### Background worker РІ `packages/worker`

Р¤РѕРЅРѕРІС‹Р№ job (РЅРµ РЅР° write-line parse) РІС‹РїРѕР»РЅСЏРµС‚ РїР°Р№РїР»Р°Р№РЅ:

```text
load mat_parse_location (window)
  в†’ pre-collapse (ADR-009)
  в†’ kinematic/static routing (ADR-008)
  в†’ spatio-temporal linking (РїСЂРµРґРѕРє в†’ РїРѕС‚РѕРјРѕРє)
  в†’ Kalman correct/predict per track
  в†’ persist trajectory_*
```

**РџСЂРёРЅС†РёРїС‹:**

- **Spatio-Temporal Clustering** вЂ” СЃРІСЏР·СЊ С‚РѕС‡РµРє РїРѕ Р±Р»РёР·РѕСЃС‚Рё РІ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРµ Рё РІСЂРµРјРµРЅРё.
- **Kalman Filtering** вЂ” СЃРѕСЃС‚РѕСЏРЅРёРµ `[x, y, vx, vy]`; РјР°С‚СЂРёС†Р° С€СѓРјР° РїСЂРѕС†РµСЃСЃР° Q РјР°СЃС€С‚Р°Р±РёСЂСѓРµС‚СЃСЏ РѕС‚ `dtВі`, `dtвЃґ`.
- **Directed graph** вЂ” СѓР·Р»С‹ (`mat_track_node`) Рё СЂС‘Р±СЂР° parentв†’child РІРЅСѓС‚СЂРё С‚СЂРµРєР°.

### РҐСЂР°РЅРµРЅРёРµ (РїСЂРµРґР»РѕР¶РµРЅРёРµ)

```sql
mat_track (
  id              uuid PK,
  status          text,       -- active | closed | stale
  first_at        timestamptz,
  last_at         timestamptz,
  last_lat        numeric,
  last_lon        numeric,
  velocity_ms     numeric,    -- |v| РёР· Kalman
  bearing_deg     numeric,
  node_count      int,
  created_at      timestamptz,
  updated_at      timestamptz
)

mat_track_node (
  id              uuid PK,
  track_id        uuid FK в†’ mat_track,
  seq             int,        -- РїРѕСЂСЏРґРѕРє РІ С‚СЂРµРєРµ
  occurred_at     timestamptz,
  lat             numeric,
  lon             numeric,
  mode            text,       -- correct | attach_only (ADR-008)
  event_location_id uuid FK,  -- nullable РґР»СЏ synthetic nodes
  kalman_state    jsonb,     -- { x, y, vx, vy, P: number[4][4] }
  source_refs     jsonb,      -- [{ rawMessageId, parsedEventId, text }]
  created_at      timestamptz
)
```

РРЅРґРµРєСЃС‹: `(track_id, seq)`, `(occurred_at)`, `(event_location_id)` unique where not null.

### SSOT Р»РѕРіРёРєРё

`packages/shared/src/domain/tracking/` вЂ” pure functions:

- `linkNodes(candidates)` вЂ” spatio-temporal graph
- `kalmanStep(state, observation, dt)` вЂ” РѕР±С‘СЂС‚РєР° РЅР°Рґ `kalman-filter`
- `buildTrack(nodes)` вЂ” Р°РіСЂРµРіР°С†РёСЏ РјРµС‚Р°РґР°РЅРЅС‹С… С‚СЂРµРєР°

Worker вЂ” РѕСЂРєРµСЃС‚СЂР°С‚РѕСЂ; API вЂ” read adapter.

### API (read-side)

| Endpoint | РќР°Р·РЅР°С‡РµРЅРёРµ |
|----------|------------|
| `GET /map/tracks` | РЎРїРёСЃРѕРє С‚СЂРµРєРѕРІ Р·Р° РїРµСЂРёРѕРґ / bbox / `asOf` |
| `GET /map/tracks/:id` | РџРѕР»РЅС‹Р№ С‚СЂРµРє СЃ nodes Рё Kalman snapshot |

Query: `since`, `until`, `asOf`, `bbox`, `status`, `limit`.

### Zod-СЃРєРµР»РµС‚С‹ РєРѕРЅС‚СЂР°РєС‚РѕРІ (РѕРїРёСЃР°РЅРёРµ, СЂРµР°Р»РёР·Р°С†РёСЏ вЂ” С„Р°Р·Р° 1)

```typescript
/** РЎР»РѕР№ СЃРµРіРјРµРЅС‚Р° С‚СЂРµРєР° РґР»СЏ Kill/Pass (ADR-010). */
type TrackLayer = "body" | "kill" | "pass";

type TrajectoryNode = {
  id: string;
  seq: number;
  occurredAt: string; // ISO8601
  lat: number;
  lon: number;
  mode: "correct" | "attach_only";
  sourceRefs: Array<{ rawMessageId?: string; parsedEventId?: string; text?: string }>;
};

type TrajectoryTrack = {
  id: string;
  status: "active" | "closed" | "stale";
  firstAt: string;
  lastAt: string;
  velocityMs: number | null;
  bearingDeg: number | null;
  nodes: TrajectoryNode[];
  /** Р—Р°РїРѕР»РЅСЏРµС‚СЃСЏ ADR-010. */
  segments?: Array<{ layer: TrackLayer; fromSeq: number; toSeq: number }>;
};
```

---

## РќРµ РґРµР»Р°РµРј

- Realtime Kalman РЅР° write-line parse вЂ” С‚РѕР»СЊРєРѕ batch/РёРЅРєСЂРµРјРµРЅС‚Р°Р»СЊРЅС‹Р№ worker.
- РР·РјРµРЅРµРЅРёРµ operational fold РёР»Рё `mat_parse_event` schema РЅР° РїРµСЂРІРѕРј СЌС‚Р°РїРµ.
- Р–С‘СЃС‚РєР°СЏ РїСЂРёРІСЏР·РєР° Рє Р±РѕСЂС‚РѕРІРѕРјСѓ РЅРѕРјРµСЂСѓ вЂ” С‚СЂРµРє = emergent cluster.

---

## РџРѕСЃР»РµРґСЃС‚РІРёСЏ

| РџР»СЋСЃ | РњРёРЅСѓСЃ |
|------|-------|
| РђРІС‚РѕРјР°С‚РёР·Р°С†РёСЏ Р±РµР· object ID | РќРѕРІС‹Рµ С‚Р°Р±Р»РёС†С‹ + worker job |
| РћСЃРЅРѕРІР° РґР»СЏ РїСЂРѕРіРЅРѕР·Р° Рё Kill/Pass | РќСѓР¶РµРЅ checkpoint/rebuild РїСЂРё СЃРјРµРЅРµ Р°Р»РіРѕСЂРёС‚РјР° |
| Р§РёСЃС‚РѕРµ СЂР°Р·РґРµР»РµРЅРёРµ РѕС‚ fold | Р›Р°С‚РµРЅС‚РЅРѕСЃС‚СЊ: С‚СЂРµРєРё РѕС‚СЃС‚Р°СЋС‚ РѕС‚ live ingest |

---

## РљСЂРёС‚РµСЂРёРё РїСЂРёРЅСЏС‚РёСЏ

- Worker РїРµСЂРµСЃРѕР±РёСЂР°РµС‚ С‚СЂРµРєРё РёР· `mat_parse_location` РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕ (re-run safe).
- API РѕС‚РґР°С‘С‚ `TrajectoryTrack` РІР°Р»РёРґРёСЂСѓРµРјС‹Р№ Zod.
- Unit-С‚РµСЃС‚С‹ РЅР° link + Kalman step РІ `@radar/shared`.

