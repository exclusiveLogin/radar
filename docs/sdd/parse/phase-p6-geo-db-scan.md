# P6: Parse Geo DOD (ADR-012 + region-as-place)

## Цель

Runtime geo-spawn parse V2 **только из БД** `places` + `regions` (metadata/FK). Без `GeoCatalog`/JSON/OSM/places.json в hot path.

## Архитектура

| Компонент | Роль |
|-----------|------|
| `IPlaceScanPort` | Shared port: `matchRegions`, `matchPlaces`, `regionIsoForPlace` |
| `PlaceScanService` | In-memory index из `listScanEntries()` |
| `GeoSpanTokenizer` | MO/GO/район spans на `groomedText` |
| `PlaceResolvePolicy` | regionScope → kindFloor → stable sort → `geoImprecise` |
| `geoProcessor` | Spawn candidates с `placeId`, `regionCode`, span |
| `deriveRegionFromPlace` | Region facet из `place.region_id` без region-anchor |
| `GeoValidationService` | Stem-only match, без `places.json` |

## Wiring

- Composition root: `createPlaceScanService({ places, regions })`
- `ParseProcessorContext.placeScan` (не `geoCatalog`)
- Worker pool: `placeScanEntries` в `ParsePipelineWorkerConfig`

## Post-deploy (radar CLI)

```powershell
npm run build
npm run radar -- stack migrate
# restart worker
npm run radar -- pipeline reset
npm run radar -- parse run
npm run radar -- pipeline parity
```

Опционально: `npm run radar -- geo catalog:import` если places неполные.

## Тесты

```powershell
npx tsx --test packages/worker/src/domain/parse/parseWorkspace.golden.test.ts
npx tsx --test packages/shared/src/domain/geo/placeMatchLabel.test.ts
```

Fixture: `buildTestPlaceScanService()` / `GF_P6_SCAN_ENTRIES`.

## Статус

✅ Implemented (P6 DOD)
