> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.`n`n# ADR-010: Kill / Pass вЂ” СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ РїРµСЂРµС…РІР°С‚Р° (read-side СЃР»РѕРё)

Р”Р°С‚Р°: 2026-06-12  
РЎС‚Р°С‚СѓСЃ: **РџСЂРµРґР»РѕР¶РµРЅРѕ**

РЎРІСЏР·Р°РЅРѕ: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [roadmap](./roadmap-tracking-forecasting.md), [ADR-014 В§ D6](./adr-014-operational-domain-profile.md#api-read-side-decoupling-С„Р°Р·Р°-d6)

---

## РљРѕРЅС‚РµРєСЃС‚

Operational РєР°СЂС‚Р° РїРѕРєР°Р·С‹РІР°РµС‚ С„Р°РєС‚С‹ Рё Р»РµРЅС‚Сѓ macro-РѕС‚С‡С‘С‚РѕРІ (`pvo_report`), РЅРѕ РЅРµ РѕС‚РІРµС‡Р°РµС‚ РЅР° РІРѕРїСЂРѕСЃ: **РіРґРµ РїРµСЂРµС…РІР°С‚ СЂРµР°Р»СЊРЅРѕ РѕСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ С†РµР»Рё, Р° РіРґРµ РїСЂРѕРїСѓСЃРєР°РµС‚?** Р‘СѓРјР°Р¶РЅС‹Р№ СЂР°РґРёСѓСЃ РїРѕСЂР°Р¶РµРЅРёСЏ РєРѕРјРїР»РµРєСЃР° С‡Р°СЃС‚Рѕ РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ OSINT-РЅР°Р±Р»СЋРґРµРЅРёСЏРјРё.

**РџСЂРёРЅС†РёРїС‹:** Kill Chain Analysis, Spatio-Temporal Interference.

**Value:** РѕС‡РµРЅСЊ РІС‹СЃРѕРєР°СЏ вЂ” С‡РёСЃС‚Р°СЏ РІРѕРµРЅРЅР°СЏ Р°РЅР°Р»РёС‚РёРєР°, РєРѕСЂРёРґРѕСЂС‹ РїСЂРѕСЂС‹РІР°.

---

## Р РµС€РµРЅРёРµ

### РўСЂРё read-side СЃР»РѕСЏ

| РЎР»РѕР№ | ID | РЎРѕРґРµСЂР¶Р°РЅРёРµ |
|------|-----|------------|
| Report density heatmap | `pvo_heatmap` | РџР»РѕС‚РЅРѕСЃС‚СЊ `pvo_report` / air_defense СЃРѕР±С‹С‚РёР№ (в†’ D6: generic filter) |
| Kill | `kill` | Terminal nodes С‚СЂРµРєРѕРІ РІ Р·РѕРЅРµ РїРµСЂРµС…РІР°С‚Р° (РїРѕРґС‚РІРµСЂР¶РґС‘РЅРЅС‹Рµ СЃР±РёС‚РёСЏ) |
| Pass | `pass` | РЎРµРіРјРµРЅС‚С‹ С‚СЂРµРєРѕРІ, РїСЂРѕС€РµРґС€РёРµ Р·РѕРЅСѓ Рё РїСЂРѕРґРѕР»Р¶РёРІС€РёРµ РґРІРёР¶РµРЅРёРµ |

### РљР»Р°СЃСЃРёС„РёРєР°С†РёСЏ СЃРµРіРјРµРЅС‚РѕРІ

Р’С…РѕРґ:

- `mat_track` + `mat_track_node` ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md))
- Р—РѕРЅС‹ РїРµСЂРµС…РІР°С‚Р°: buffer РІРѕРєСЂСѓРі report-С‚РѕС‡РµРє + РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ РїРѕР»РёРіРѕРЅС‹ РїРѕРєСЂС‹С‚РёСЏ (v2)

РџСЂР°РІРёР»Р° v1:

1. **Kill:** РїРѕСЃР»РµРґРЅРёР№ kinematic node С‚СЂРµРєР° (`correct`) РїРѕРїР°РґР°РµС‚ РІ Р·РѕРЅСѓ Рё С‚СЂРµРє `closed` Р±РµР· РІС‹С…РѕРґР° РёР· Р·РѕРЅС‹ РІ С‚РµС‡РµРЅРёРµ `KILL_CONFIRM_WINDOW` (default 30 min).
2. **Pass:** СЃСѓС‰РµСЃС‚РІСѓРµС‚ СЃРµРіРјРµРЅС‚ `[node_i в†’ node_{i+1}]`, РіРґРµ `node_i` РІРЅСѓС‚СЂРё Р·РѕРЅС‹, `node_{i+1}` СЃРЅР°СЂСѓР¶Рё, Рё С‚СЂРµРє РїСЂРѕРґРѕР»Р¶Р°РµС‚СЃСЏ в‰Ґ 2 nodes РїРѕСЃР»Рµ РІС‹С…РѕРґР°.
3. **Body:** РѕСЃС‚Р°Р»СЊРЅС‹Рµ СЃРµРіРјРµРЅС‚С‹ С‚СЂРµРєР°.

```typescript
type TrackLayer = "body" | "kill" | "pass";

type TrackSegment = {
  trackId: string;
  layer: TrackLayer;
  fromSeq: number;
  toSeq: number;
  coordinates: Array<[lon, lat]>;
};
```

### API РєРѕРЅС‚СЂР°РєС‚

| Endpoint | РћС‚РІРµС‚ |
|----------|-------|
| `GET /map/tracks/layers?layer=kill\|pass\|pvo_heatmap` | GeoJSON FeatureCollection |
| `GET /map/tracks/:id` | `segments[]` СЃ `layer` (embedded) |

Query: `since`, `until`, `asOf`, `bbox`, `limit`.

### GeoJSON properties (kill/pass segment)

```typescript
{
  trackId: string;
  layer: "kill" | "pass" | "body";
  fromSeq: number;
  toSeq: number;
  velocityMs: number | null;
  lastAt: string;
}
```

### Report density heatmap

Р Р°СЃС€РёСЂРµРЅРёРµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ heatmap-РїР°С‚С‚РµСЂРЅР° ([event-heatmap.ts](../packages/shared/src/schemas/map/event-heatmap.ts)):

- Р¤РёР»СЊС‚СЂ: С‡РµСЂРµР· `status_dictionary.feed_kind` / `eventCategory` (РЅРµ hardcode РІ SQL вЂ” ADR-014 D6)
- РћС‚РґРµР»СЊРЅС‹Р№ endpoint РёР»Рё `layer=pvo_heatmap` РЅР° unified layers API

### Р’С‹С‡РёСЃР»РµРЅРёРµ

- Batch job РІ tracking worker (РїРѕСЃР»Рµ rebuild С‚СЂРµРєРѕРІ) РёР»Рё on-read СЃ РєРµС€РµРј.
- v1: **materialized** `trajectory_segments` table (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ) РґР»СЏ РїСЂРѕРёР·РІРѕРґРёС‚РµР»СЊРЅРѕСЃС‚Рё.

---

## Р—Р°РІРёСЃРёРјРѕСЃС‚Рё

- ADR-007 вЂ” РіРѕС‚РѕРІС‹Рµ С‚СЂРµРєРё
- Macro feed (`GET /map/event-feed` РїРѕСЃР»Рµ D6) вЂ” РёСЃС‚РѕС‡РЅРёРє С„Р°РєС‚РѕРІ, РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ write-path

---

## РќРµ РґРµР»Р°РµРј

- РћС†РµРЅРєСѓ С‚РёРїР° С†РµР»Рё РЅР° РїРµСЂРІРѕРј СЌС‚Р°РїРµ
- 3D Р·РѕРЅС‹ вЂ” С‚РѕР»СЊРєРѕ 2D buffer v1

---

## РџРѕСЃР»РµРґСЃС‚РІРёСЏ

| РџР»СЋСЃ | РњРёРЅСѓСЃ |
|------|-------|
| Р РµР°Р»СЊРЅР°СЏ, Р° РЅРµ Р±СѓРјР°Р¶РЅР°СЏ РєР°СЂС‚РёРЅР° РїРµСЂРµС…РІР°С‚Р° | РљР°С‡РµСЃС‚РІРѕ Р·Р°РІРёСЃРёС‚ РѕС‚ РїРѕР»РЅРѕС‚С‹ macro-РѕС‚С‡С‘С‚РѕРІ |
| РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРёРµ РєРѕСЂРёРґРѕСЂС‹ РїСЂРѕСЂС‹РІР° | False kill РїСЂРё РіСЂСѓР±РѕР№ РіРµРѕР»РѕРєР°С†РёРё |

---

## РљСЂРёС‚РµСЂРёРё РїСЂРёРЅСЏС‚РёСЏ

- API РѕС‚РґР°С‘С‚ С‚СЂРё СЃР»РѕСЏ, РІР°Р»РёРґРёСЂСѓРµРјС‹Рµ Zod
- Golden fixture: С‚СЂРµРє С‡РµСЂРµР· Р·РѕРЅСѓ в†’ segment `pass`
- Golden fixture: С‚СЂРµРє РѕР±СЂС‹РІР°РµС‚СЃСЏ РІ Р·РѕРЅРµ в†’ node `kill`

