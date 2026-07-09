> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.`n`n# ADR-006: Write-line facts, read-line fold РѕС‚ РєСѓСЂСЃРѕСЂР° РІСЂРµРјРµРЅРё

## РљРѕРЅС‚РµРєСЃС‚

РћРїРµСЂР°С†РёРѕРЅРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ РєР°СЂС‚С‹ (winner, СѓСЂРѕРІРµРЅСЊ, РІРёРґРёРјРѕСЃС‚СЊ) СЂР°РЅСЊС€Рµ РјР°С‚РµСЂРёР°Р»РёР·РѕРІР°Р»РѕСЃСЊ РІ
`region_status_read_model` / `place_status_read_model` РЅР° write-path
(`LastWinnerReadModelProjection`, `MapStateExpirySweep`). Р­С‚Рѕ РґР°РІР°Р»Рѕ СЂР°СЃСЃРёРЅС…СЂРѕРЅ
region/place, stale-С„Р»Р°РіРё Рё Р·Р°РІРёСЃРёРјРѕСЃС‚СЊ РѕС‚ РІСЂРµРјРµРЅРё reparse.

**РЎС‚Р°С‚СѓСЃ (2026):** РјРёРіСЂР°С†РёСЏ Р·Р°РІРµСЂС€РµРЅР°. Materialized read_model СѓРґР°Р»С‘РЅ РёР· РєРѕРґР° Рё Р‘Р”.

## Р РµС€РµРЅРёРµ

### Write-line вЂ” С‚РѕР»СЊРєРѕ С„Р°РєС‚С‹

Append-only С†РµРїРѕС‡РєР°:

- `mat_ingest_raw` (`posted_at`)
- `mat_parse_event`
- `mat_parse_location` (`occurred_at` = postedAt РїСѓР±Р»РёРєР°С†РёРё)

РРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚СЊ ingest/parse вЂ” РїРѕ hash Рё identity СЃРѕРѕР±С‰РµРЅРёСЏ.
**РЎС‚Р°С‚СѓСЃС‹ РЅР° write-line РЅРµ С…СЂР°РЅСЏС‚СЃСЏ.**

РљРѕСЂСЂРµРєС†РёСЏ СЃРѕРѕР±С‰РµРЅРёСЏ (edit/revision) вЂ” **РЅРѕРІС‹Р№ raw + parse**, С‚РѕС‚ Р¶Рµ `posted_at`;
fold РЅР° read-side РІС‹Р±РёСЂР°РµС‚ winner (clear Р±СЊС‘С‚ raise РїСЂРё С‚РѕРј Р¶Рµ РІСЂРµРјРµРЅРё).

### Read-line вЂ” РІС‹С‡РёСЃР»РµРЅРёРµ РѕС‚ РјР°СЂРєРµСЂР° РІСЂРµРјРµРЅРё

```text
snapshot(asOf, policies) = foldMapState(facts where occurred_at <= asOf)
```

- `asOf` РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ `now`; UI вЂ” РїРѕР»Р·СѓРЅРѕРє С‚Р°Р№РјР»Р°Р№РЅР° (`MapTimelineBar`)
- TTL 24h: С„Р°РєС‚ РІРЅРµ РѕРєРЅР° `(asOf - TTL, asOf]` РЅРµ СѓС‡Р°СЃС‚РІСѓРµС‚ РІ fold
- Fade 3h: РЅР° С„СЂРѕРЅС‚Рµ РѕС‚ `statusEventAt` (= winner `occurred_at`)
- Place suppress: СЂРµРіРёРѕРЅР°Р»СЊРЅС‹Р№ clear РЅРѕРІРµРµ place raise (СЃРј. `isPlaceSuppressedByRegionClear`)

SSOT Р»РѕРіРёРєРё fold: `packages/shared/src/domain/region-state/mapStateFold.ts`  
SSOT Р·Р°РіСЂСѓР·РєРё С„Р°РєС‚РѕРІ: `packages/shared/src/domain/region-state/mapFactsLoader.ts`

### РђСЂС…РёС‚РµРєС‚СѓСЂР° API

- `MapFactsRepository` вЂ” Р·Р°РіСЂСѓР·РєР° С„Р°РєС‚РѕРІ
- `MapSnapshotQueryService` вЂ” fold + enrich в†’ `MapSnapshot`
- `MapQueryService` вЂ” REST adapter
- `MapFoldRealtimePoller` вЂ” WS diff fold snapshot(now)

## API

| Endpoint | РСЃС‚РѕС‡РЅРёРє |
|----------|----------|
| `GET /map/snapshot` | fold РЅР° `now` |
| `GET /map/snapshot?asOf=ISO` | fold РЅР° РјР°СЂРєРµСЂ РІСЂРµРјРµРЅРё (С‚Р°Р№РјР»Р°Р№РЅ) |
| `GET /map/snapshot?since=ISO` | fold РЅР° `now`, С„РёР»СЊС‚СЂ РїРѕ `statusEventAt > since` |

`since` Рё `asOf` РІР·Р°РёРјРѕРёСЃРєР»СЋС‡Р°СЋС‰РёРµ.

## Layered transport (state + geo)

Fold РѕСЃС‚Р°С‘С‚СЃСЏ SSOT РїСЂР°РІРёР»; transport СЂР°Р·РґРµР»С‘РЅ РЅР° РЅРµР·Р°РІРёСЃРёРјС‹Рµ read-СЃР»РѕРё:

| Endpoint | РЎРѕРґРµСЂР¶РёРјРѕРµ | Fold |
|----------|------------|------|
| `GET /map/regions-state` | region winners + layout/centroid | РґР° (region-scoped facts) |
| `GET /map/places-state` | active places (lat/lon, geoFeatureId) | РґР° (place facts + suppress) |
| `GET /map/regions-geojson?regionCodes=` | OSM РєРѕРЅС‚СѓСЂС‹ СЃСѓР±СЉРµРєС‚РѕРІ | РЅРµС‚ |
| `GET /map/districts-geojson?geoFeatureIds=` | РїРѕР»РёРіРѕРЅС‹ СЂР°Р№РѕРЅРѕРІ | РЅРµС‚ |
| `GET /map/snapshot` | composite (legacy / Time Machine shortcut) | РґР° |

**Bootstrap С„СЂРѕРЅС‚Р°:** `regions-state` + `places-state` + WS deltas; geo lazy РїРѕ visible region codes Рё `geoFeatureId` place-СЃРѕР±С‹С‚РёР№.

**Poller:** regions fold РєР°Р¶РґС‹Рµ 1s, places fold РєР°Р¶РґС‹Рµ 3s; WS seed вЂ” regions-only (`places: []`).

РРЅРґРµРєСЃС‹ read-path: `mat_parse_location(occurred_at)`, `(raise, occurred_at)`, `mat_ingest_raw(posted_at)`.

## Р’РЅРµ scope ADR

- Raw semantic dedup cross-channel (`posted_at` + normalized text)
- РџРµСЂРµРёРјРµРЅРѕРІР°РЅРёРµ `mat_parse_event.parsed_at` в†’ `posted_at` РІ СЃС…РµРјРµ Р‘Р”

