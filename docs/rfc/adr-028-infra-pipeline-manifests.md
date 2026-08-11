# ADR-028: Infra vs pipeline manifests + open topic catalog

## Status

Accepted (2026-08-11).

## Context

`deployment.manifest.json` смешивал «где развёрнуто» и «что течёт». Топики шины жили в закрытых enum'ах → новый шаг требовал правки кода. Нужна декларативная топология шагов (`trigger` / `emits`) без composition-wiring.

Связано: ADR-021 (manifest↔env), ADR-022 (RMQ roles), ADR-025 (unified pipeline).

## Decision

1. **Два манифеста**
   - `infra.manifest.json` (`INFRA__`) — process, runners hosts/spawn, obs, compose, transport.
   - `pipeline.manifest.json` (`PIPELINE__`) — `steps[]` + `phases[]`.
2. Один loader: `loadDomainManifest` + keyed merge по `id` для `steps` / `phases`.
3. **Открытый каталог топиков**: `buildTopicCatalog(manifest) = system keys ∪ step.trigger.on ∪ step.emits`. `ensureTopology` строится из каталога, не из закрытого enum.
4. Шаг — единица описания; граф = совпадение emits→trigger; isolate только на egress.

## Consequences

- Файл `deployment.manifest.json` удалён.
- Contract-тест на реальном `pipeline.manifest.json` ловит опечатки в ключах.
- Справочник `docs/reference/pipeline-triggers.md` генерируется (`generatePipelineTriggersDoc`) + snapshot-тест.
- Admin/CLI будят шаги через `StepRunRequested`, не через phase-поллер.

## See also

- [pipeline-steps SDD](../sdd/pipeline-steps/README.md)
- [pipeline-hooks-and-events](../domain/pipeline-hooks-and-events.md)
- [ADR-021](adr-021-manifest-env-ssot.md)
