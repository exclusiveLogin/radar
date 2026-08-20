# Контекст: Geo и Place (trust)

## Зачем

Как parse обновляет `places`, trust и evidence — связка с [docs/place-trust-explained.md](../../place-trust-explained.md).

## Как работает при parse

1. `ParsePipelineService` возвращает кандидаты `EventLocation`.
2. `GeoValidationService.validate` для каждого кандидата:
   - резолв субъекта: `place_aliases` → `place(kind=region)` → `regions`;
   - match НП по alias/name в scope `regions.id`;
   - `applyProviderContribution` → `mergeContribution` + `placeEvidence.append`.
3. `mergePlaceContribution` (shared) — монотонный `trustState`, правила перезаписи полей по confidence.
4. `TypeOrmPlaceRepository.mergeContribution` — TX + `pessimistic_write` lock.

## Trust

| Поле | Источник |
|------|----------|
| `trustState`, `isTrusted`, `trustScore` | `toTrustState()` в `GeoValidationService` + merge |
| `place_evidence` | append после merge |

Продуктовое объяснение: [place-trust-explained.md](../../place-trust-explained.md).

## Geo sync (отдельный поток)

`GeoSyncApplyService` — bulk load регионов/places/aliases из датасета:

- audit в `log_geo_sync`;
- события `GeoSyncCompleted` / `GeoSyncFailed`, `aggregateType: geo_sync`, `aggregateId: auditRow.id`;
- запись в outbox через `IDomainEventRepository.append`.

Не путать с точечным merge при parse.

## Где в коде

| Файл |
|------|
| `packages/worker/.../geoValidationService.ts` |
| `packages/shared/.../placeContributionMerge.ts` |
| `packages/api/.../typeorm-place.repository.ts` |
| `packages/api/.../typeorm-place-evidence.repository.ts` |
| `packages/api/.../geo-sync-apply.service.ts` |

Сквозной поток: [how-it-works.md#place-trust-flow](../how-it-works.md#place-trust-flow).

## FAQ

**Богатый агрегат Place?**  
Нет класса `PlaceAggregate` — `PlaceRecord` + pure merge + repo TX.

**Evidence в той же TX, что merge?**  
Нет — `append` после `mergeContribution` (отдельный вызов). См. validation-report.
