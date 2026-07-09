> **Конфигурация:** [ADR-021 manifest env SSOT](./rfc/adr-021-manifest-env-ssot.md) — `deployment.manifest.json` → `runners.pipelines[].schedulingImpl`. Ниже ADR-016 описывает **архитектуру** runner platform.

> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.

# ADR-016: Runner platform вЂ” РµРґРёРЅС‹Р№ СЂР°РЅС‚Р°Р№Рј РґР»СЏ tracking/parse/geo-enrich

Р”Р°С‚Р°: 2026-07-02
РЎС‚Р°С‚СѓСЃ: **РџСЂРёРЅСЏС‚Рѕ** (Wave 1вЂ“6 РІ РєРѕРґРµ, Р·Р° feature-С„Р»Р°РіР°РјРё, legacy-СЂР°РЅРЅРµСЂС‹ РІР·Р°РёРјРѕРёСЃРєР»СЋС‡Р°СЋС‰РёРµ)

РЎРІСЏР·Р°РЅРѕ: [ADR-014 ODP](./adr-014-operational-domain-profile.md), [ADR-015 nextgen-gravity](./adr-015-data-association-reuse-and-locus.md), [SDD runner-platform](./sdd/runner-platform/README.md)

---

## РљРѕРЅС‚РµРєСЃС‚

Р”Рѕ СЌС‚РѕРіРѕ ADR РєР°Р¶РґС‹Р№ РґРѕРјРµРЅ (`tracking`, `parse`, `geo-enrich`) РіРѕРЅСЏР» СЃРІРѕР№ РґРµРјРѕРЅ: СЂСѓС‡РЅРѕР№ `setInterval`, СЃРІРѕР№ РёРЅР»Р°Р№РЅ-SQL РґР»СЏ РєСѓСЂСЃРѕСЂР°/lock/СЃС‚Р°С‚СѓСЃР°, СЃРІРѕР№ СЃРїРѕСЃРѕР± СЃР»Р°С‚СЊ РїСЂРѕРіСЂРµСЃСЃ РІ WS. РћР±С‰РµРіРѕ РјРµР¶РґСѓ РЅРёРјРё Р±С‹Р»Рѕ РјРЅРѕРіРѕ (schedule tick, lock, cursor read/advance, control pause/cancel, telemetry envelope), РЅРѕ РєРѕРґ РЅРµ РїРµСЂРµРёСЃРїРѕР»СЊР·РѕРІР°Р»СЃСЏ вЂ” С‚СЂРё РєРѕРїРёРё РѕРґРЅРѕР№ Рё С‚РѕР№ Р¶Рµ РјРµС…Р°РЅРёРєРё СЃ СЂР°Р·РЅС‹РјРё Р±Р°РіР°РјРё.

Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ: `parse` РёСЃРїРѕР»СЊР·РѕРІР°Р» message-copy queue (`CoverageEnqueuer` в†’ `queue_parse_coverage`), РґСѓР±Р»РёСЂСѓСЏ РєР°Р¶РґРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІ РѕС‡РµСЂРµРґСЊ РґР»СЏ РєР°Р¶РґРѕР№ С„Р°Р·С‹ РІРјРµСЃС‚Рѕ РєСѓСЂСЃРѕСЂР° РїРѕ raw SSOT.

## Р РµС€РµРЅРёРµ

РћР±С‰РёР№ СЂР°РЅРЅРµСЂ РІС‹РЅРµСЃРµРЅ РІ **runner platform** вЂ” РЅР°Р±РѕСЂ generic-РјРѕРґСѓР»РµР№ Р±РµР· РґРѕРјРµРЅРЅРѕРіРѕ Р·РЅР°РЅРёСЏ:

| РњРѕРґСѓР»СЊ | Р¤Р°Р№Р» | РќР°Р·РЅР°С‡РµРЅРёРµ |
|---|---|---|
| `jobKernel` | `packages/worker/src/application/runtime/runner-platform/jobKernel.ts` | РЎРѕР±РёСЂР°РµС‚ schedule + lock + cursor + `PipelineCallbacks` + telemetry РІ РѕРґРёРЅ С‚РёРє |
| `cursorEngine` | `.../cursorEngine.ts` | Read/advance/reset РєСѓСЂСЃРѕСЂР°; С„РѕСЂРјСѓ РєСѓСЂСЃРѕСЂР° СЂРµС€Р°РµС‚ РґРѕРјРµРЅ (`CursorStore<TCursor>`) |
| `scheduleEngine` | `.../scheduleEngine.ts` | interval/event/hybrid С‚РёРє + `wake()` |
| `lockEngine` | `.../lockEngine.ts` | In-process mutex РЅР° `pipelineKey`, РЅРµ РґР°С‘С‚ РґРІСѓРј С‚РёРєР°Рј РѕРґРЅРѕРіРѕ pipeline РїРµСЂРµСЃРµС‡СЊСЃСЏ |
| `telemetryBus` | `.../telemetryBus.ts` | Publish/subscribe РґР»СЏ `SignalEnvelope<TArtifact>` |
| `runnerContracts` | `.../runnerContracts.ts` | РўРёРїС‹: `PipelineCallbacks`, `SignalEnvelope`, `SignalPolicy` (`durable/persist/ephemeral`) |

Р”РѕРјРµРЅ РїРѕРґРєР»СЋС‡Р°РµС‚СЃСЏ С‡РµСЂРµР· `PipelineCallbacks<TCursor, TSlice, TArtifact>` = `{ loadSlice, evaluate, materialize, emitProgress? }` вЂ” СЌС‚Рѕ Рё РµСЃС‚СЊ `ingest -> run -> materialize` РёР· РёСЃС…РѕРґРЅРѕРіРѕ РїР»Р°РЅР°.

**Workbook/workload** (`packages/shared/src/domain/workbook/`, `packages/worker/src/application/runtime/workload/`) вЂ” РґРµРєР»Р°СЂР°С‚РёРІРЅС‹Р№ СЃР»РѕР№ РїРѕРІРµСЂС… platform:

- `createWorkbook({ pipelineKey, phases, evaluate })` вЂ” С‡РµСЂС‚С‘Р¶ РєРѕРЅРІРµР№РµСЂР°, С‡РёСЃС‚Р°СЏ С„СѓРЅРєС†РёСЏ `evaluate`, С‚РµСЃС‚РёСЂСѓРµС‚СЃСЏ Р±РµР· runtime.
- `createWorkload({ workbook, io, schedule })` вЂ” СЃРІСЏР·С‹РІР°РµС‚ workbook СЃ `jobKernel` + I/O-РїРѕСЂС‚Р°РјРё РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ РґРѕРјРµРЅР° в†’ РІРѕР·РІСЂР°С‰Р°РµС‚ `Workload` (РїРѕ СЃСѓС‚Рё `JobKernel` + `descriptor`).
- `TriggerLayer` (`triggerLayer.ts`) вЂ” debounce + gate РїРµСЂРµРґ `workload.enqueue()`, РёСЃС‚РѕС‡РЅРёРє (`bus | scheduler | manual | cli`) РЅРµ РІР°Р¶РµРЅ РґР»СЏ workload.
- `wireBusTrigger(bus, eventType, options)` вЂ” РїРѕРґРїРёСЃС‹РІР°РµС‚ `TriggerLayer` РЅР° С€РёРЅСѓ СЃРѕР±С‹С‚РёР№ (Wave 6, С…РѕСЂРµРѕРіСЂР°С„РёСЏ РІРјРµСЃС‚Рѕ РѕСЂРєРµСЃС‚СЂР°С†РёРё).

РљРѕРґ-first: Р±РµР· РѕС‚РґРµР»СЊРЅРѕРіРѕ DSL/manifest-С„Р°Р№Р»Р° вЂ” workbook РѕРїРёСЃС‹РІР°РµС‚СЃСЏ TS-С„Р°Р±СЂРёРєРѕР№ Рё РєРѕР»Р±РµРєРѕРј (СЂРµС€РµРЅРёРµ `functional-composition`, Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј).

## РњРёРіСЂР°С†РёСЏ РїРѕ РґРѕРјРµРЅР°Рј (waves)

| Wave | Р”РѕРјРµРЅ | Р¤Р°Р№Р» СЂР°РЅРЅРµСЂР° | `schedulingImpl` (manifest) | Статус |
|---|---|---|---|---|
| 3 | tracking | `application/tracking/runner/trackingRunner.ts` | `legacy` (default) / `runner-platform` | код готов |
| 4 | parse | `application/parse/runner/parseRunnerRegistry.ts` | `legacy` (default) / `runner-platform` | код готов |
| 5 | geo-enrich | `application/geo-parse/runner/geoEnrichRunner.ts` | `legacy` (default) / `runner-platform` | код готов |
| 6 | cross-context | `wireBusTrigger` РІ `createWorkerCompositionRoot.ts` | активен только когда `schedulingImpl=runner-platform` | код готов |

Р›РµРіР°СЃРё-СЂР°РЅРЅРµСЂ Рё РЅРѕРІС‹Р№ СЂР°РЅРЅРµСЂ **РІР·Р°РёРјРѕРёСЃРєР»СЋС‡Р°СЋС‰РёРµ** вЂ” РІС‹Р±РѕСЂ РѕРґРЅРѕРіРѕ РёР· РґРІСѓС… РІ `createWorkerCompositionRoot.ts`, РЅРµ РїР°СЂР°Р»Р»РµР»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє. РџРµСЂРµРєР»СЋС‡РµРЅРёРµ вЂ” через manifest `schedulingImpl` (ADR-021); удаление старого кода (Gate D, РґРѕ РѕС‚РґРµР»СЊРЅРѕРіРѕ hard-cut РІ Wave 7).

## РћС‚РЅРѕС€РµРЅРёРµ Рє ADR-014 (ODP)

`packages/worker/src/composition/odp/` (`odpManifest` + `odpResolve`) вЂ” **РЅРµ РЅРѕРІР°СЏ СЃСѓС‰РЅРѕСЃС‚СЊ**, Р° РїРµСЂРІС‹Р№ СЃСЂРµР· СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ ODP (ADR-014) РІ РєРѕРЅС‚РµРєСЃС‚Рµ runner platform: СЃРµР№С‡Р°СЃ СЌС‚Рѕ СЃС‚Р°С‚РёС‡РµСЃРєРёР№ СЃРїРёСЃРѕРє `{ pipelineKey, schedulingImpl }`, из `deployment.manifest.json`, только для лога и будущего admin UI. РћРЅ **РЅРµ СѓРїСЂР°РІР»СЏРµС‚** РєРѕРЅСЃС‚СЂСѓРёСЂРѕРІР°РЅРёРµРј СЂР°РЅРЅРµСЂРѕРІ (СЌС‚Рѕ РїРѕ-РїСЂРµР¶РЅРµРјСѓ РґРµР»Р°РµС‚ `createWorkerCompositionRoot.ts`) Рё РЅРµ РїРµСЂРµСЃРµРєР°РµС‚СЃСЏ СЃ РґРѕРјРµРЅРЅРѕР№ С‡Р°СЃС‚СЊСЋ ODP (`parser-rules`, `threatProfileRules`, `uiPresets` РёР· `profile.manifest.json`). Р”Р°Р»СЊРЅРµР№С€РµРµ СЃР»РёСЏРЅРёРµ (РїР°Р№РїР»Р°Р№РЅ-РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ РєР°Рє С‡Р°СЃС‚СЊ `profile.manifest.json`) вЂ” РѕС‚РґРµР»СЊРЅРѕРµ СЂРµС€РµРЅРёРµ, РЅРµ РІ СЂР°РјРєР°С… СЌС‚РѕРіРѕ ADR (СЃРј. [phase-d7](./sdd/odp/phase-d7-workbook-runner-integration.md)).

## Naming

`pipelineKey` (`tracking`/`parse`/`geo-enrich`) + `phaseKey` (`tracking.<stage>`, `parse.<phaseId>`, `geo-enrich.<phaseId>`) вЂ” РµРґРёРЅС‹Р№ РЅРµР№РјСЃРїРµР№СЃ РІРѕ РІСЃРµС… `SignalEnvelope`, Р»РѕРіР°С… Рё telemetry. РЈР±РёСЂР°РµС‚ РїСѓС‚Р°РЅРёС†Сѓ РјРµР¶РґСѓ parse-С„Р°Р·Р°РјРё Рё tracking-С„Р°Р·Р°РјРё, Сѓ РєРѕС‚РѕСЂС‹С… СЂР°РЅСЊС€Рµ Р±С‹Р»Рѕ РѕР±С‰РµРµ СЃР»РѕРІРѕ В«С„Р°Р·Р°В» Р±РµР· РєРѕРЅС‚РµРєСЃС‚Р°.

## РџРѕСЃР»РµРґСЃС‚РІРёСЏ

- РџР»СЋСЃ: С‚СЂРё РґРѕРјРµРЅР° РіРѕРЅСЏСЋС‚ РѕРґРёРЅ Рё С‚РѕС‚ Р¶Рµ РїСЂРѕРІРµСЂРµРЅРЅС‹Р№ РєРѕРґ РїР»Р°РЅРёСЂРѕРІР°РЅРёСЏ/Р»РѕРєР°/РєСѓСЂСЃРѕСЂР°/СЃРёРіРЅР°Р»РёРЅРіР°; РЅРѕРІС‹Р№ РґРѕРјРµРЅ РЅР° runner platform вЂ” СЌС‚Рѕ С‚РѕР»СЊРєРѕ `PipelineCallbacks`, Р±РµР· РїРµСЂРµРёР·РѕР±СЂРµС‚РµРЅРёСЏ РґРµРјРѕРЅР°.
- РџР»СЋСЃ: С…РѕСЂРµРѕРіСЂР°С„РёСЏ РІРјРµСЃС‚Рѕ РѕСЂРєРµСЃС‚СЂР°С†РёРё (Wave 6) вЂ” РЅРѕРІС‹Р№ РїРµСЂРµС…РѕРґ `raw -> parse -> tracking -> geo-enrich` РЅРµ С‚СЂРµР±СѓРµС‚ РїСЂР°РІРєРё С†РµРЅС‚СЂР°Р»СЊРЅРѕРіРѕ РѕСЂРєРµСЃС‚СЂР°С‚РѕСЂР°, С‚РѕР»СЊРєРѕ `wireBusTrigger` РЅР° РЅСѓР¶РЅРѕРј СЃРѕР±С‹С‚РёРё.
- РњРёРЅСѓСЃ (РІСЂРµРјРµРЅРЅС‹Р№): пока `schedulingImpl=legacy` по умолчанию, РІ РєРѕРґРѕРІРѕР№ Р±Р°Р·Рµ РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ Р¶РёРІСѓС‚ legacy-РґРµРјРѕРЅ Рё runner-platform-СЂР°РЅРЅРµСЂ РЅР° РѕРґРёРЅ Рё С‚РѕС‚ Р¶Рµ РґРѕРјРµРЅ вЂ” РґРІРѕР№РЅР°СЏ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ РґРѕ Wave 7 (СѓРґР°Р»РµРЅРёРµ legacy).
- РќРµ РІР°Р»РёРґРёСЂРѕРІР°РЅРѕ РїСЂРѕС‚РёРІ РїСЂРѕРґ-РЅР°РіСЂСѓР·РєРё вЂ” переключение на `runner-platform` требует отдельной проверки (Gate A–C) до prod cutover.

