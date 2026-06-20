---
name: radar-parse-geo-ca
description: >-
  Parse geo P6 — Clean Architecture, DDD, SOLID. Use when editing parse geo spawn,
  PlaceScanService, geoProcessor, deriveEventLocations, or geo validation on write-path.
---

# Radar Parse Geo — CA / DDD

## Слои (зависимости только внутрь)

| Слой | Путь | Роль |
|------|------|------|
| Ports | `packages/shared/src/ports/` | `IPlaceScanPort`, `IPlaceRepository` |
| Domain | `packages/worker/src/domain/parse/geo/` | tokenizer, kind hint, resolve policy — **pure** |
| Domain adapters | `packages/worker/src/domain/parse/geoProcessor.ts` | thin orchestration |
| Application | `packages/worker/src/application/parse/` | wire composition root |
| Infrastructure | `packages/worker/src/infrastructure/place-scan/` | index build, DB adapter |

## Запрещено в parse hot path

- `GeoCatalog`, `regions.json`, OSM Cities, `places.json`, `KnownLocalityCatalog`
- `registerPlaceAlias` на write-path
- Dual-path / feature flags / `@deprecated` shims в orchestrator
- Regex `shouldSkipLine` для geo spawn

Runtime SSOT: **DB `places` + `regions` (metadata/FK)**.

## SOLID

- **S:** tokenizer ≠ resolve policy ≠ spawn ≠ validate
- **O:** новый kind/separator → `data/parse/geo-scan.v1.yaml` или small strategy
- **D:** processors зависят от `IPlaceScanPort`, не от fs/geojson

## Occam

Один pipeline: `groomedText → spans → index.match → PlaceResolvePolicy → candidates`.

## Self-review перед merge

- [ ] parse не импортирует `infrastructure/geo-catalog/*`
- [ ] нет хардкода regex в 3+ файлах (конфиг YAML)
- [ ] InMemory + TypeORM реализуют один port
- [ ] тесты без `GeoCatalog.loadFromArtifacts()`

## ADR

- [ADR-012](../../docs/adr-012-geo-scan-without-aliases.md)
- [ADR-004](../../docs/adr-004-region-place-ssot.md)
- [RFC workspace](../../docs/rfc/parse-processor-workspace.md)
