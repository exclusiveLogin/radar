# Parse Workspace — план реализации (P1–P4)

Статус: **реализовано в коде** (2026-06-16) · ждёт приёмочной проверки  
RFC: [parse-processor-workspace.md](../../rfc/parse-processor-workspace.md)  
SDD по фазам: [README.md](./README.md)

---

## Scope

| Входит | Вне scope |
|--------|-----------|
| P1–P4: workspace → finalizer → facts | ODP D1–D6 |
| Heal / finalize CLI | Tracking T1–T4 |
| `parse:snap` / `parse:report` на SSOT `execute()` | Hot-reload registry |
| GF-P1 fixtures + unit tests | ML segmenter |

**P5 (legacy):** workspace — единственный write-path; `parsePost` / `RuleBasedEventClassifier` только eval/audit.

---

## Целевой поток (как сейчас)

```text
raw
  → groomMessage (+ segmentMessage P4)
  → ParseWorkspaceOrchestrator (processor registry P3)
  → ParseWorkspaceMessageService (geo resolve + validate)
  → ParseWorkspacePersistService.finalize
  → parsed_events + message_parse_workspace
  → MessageParsed (handler)
```

Offline: `ParsePipelineService.execute()` → orchestrator → `buildParseReportFromWorkspace` (без БД).

---

## Статус фаз

| Фаза | Статус | Ключевые артефакты |
|------|--------|-------------------|
| **P1** | ✅ код | `parse-workspace.ts`, migration `1751000000000-MessageParseWorkspace`, `ParseFinalizerService`, `ParseWorkspaceMessageService`, handler, heal CLI |
| **P2** | ✅ код | `trait-attachment.ts`, `traitProcessors.ts`, registry entries repeat/mass/count |
| **P3** | ✅ код | `data/parse/parse-processors.v1.yaml`, `processorRegistry.ts`, `processors:list/validate` |
| **P4** | ✅ код | `data/parse/segmenter-rules.v1.yaml`, `segmenter/segmentMessage.ts`, `groomMessage` |
| **P5** | 🔶 частично | Флаг убран (always on); `parsePost` не deprecated в коде |

---

## Карта кода

| Слой | Путь |
|------|------|
| Zod / ports | `packages/shared/src/schemas/parse/`, `ports/repositories.ts` |
| Migration | `packages/api/src/migrations/1751000000000-MessageParseWorkspace.ts` |
| Domain | `packages/worker/src/domain/parse/` |
| Application | `packages/worker/src/application/parse/`, `parsing/parsePipelineService.ts` |
| Handler | `packages/worker/src/application/handlers/parseRawMessageHandler.ts` |
| Wipe | `packages/worker/src/application/phases/pipelineOperationalReset.ts` (`clearParseLayerArtifacts`) |
| CLI heal | `packages/worker/src/cli/workspaceHealCli.ts`, `workspaceFinalizeCli.ts` |
| CLI registry | `packages/worker/src/cli/parseProcessorsCli.ts` |

---

## CLI

```powershell
# Offline SSOT
npm run parse:snap -w @radar/worker -- <file.txt>
npm run parse:report -w @radar/worker -- ...

# Heal без wipe
npm run parse-engine:workspace:heal -w @radar/worker -- --channel=<key> --dry-run
npm run parse-engine:workspace:heal -w @radar/worker -- --channel=<key>
npm run parse-engine:workspace:finalize -w @radar/worker -- --raw-id=<uuid>

# Registry
npm run parse-engine:processors:list -w @radar/worker
npm run parse-engine:processors:validate -w @radar/worker

# Полный reparse (handler уже workspace)
npm run parse-engine:rebuild -w @radar/worker
```

---

## Чеклист приёмки (проверим вместе)

### Сборка и тесты

- [ ] `npm run build -w @radar/shared`
- [ ] `npm run build -w @radar/worker`
- [ ] `npm run typecheck -w @radar/worker`
- [ ] `node --import tsx --test packages/worker/src/domain/parse/ParseFinalizerService.test.ts packages/worker/src/domain/parse/parseWorkspace.golden.test.ts packages/worker/src/application/handlers/parseRawMessageHandler.enrich.test.ts`

### БД (staging / local db)

- [ ] Миграция: `message_parse_workspace` + снят `uq_parsed_events_raw_parser`
- [ ] Eager parse: строка в `message_parse_workspace` (`status=finalized`) + N строк в `parsed_events`
- [ ] Reparse того же raw: старая workspace → `superseded`, без сирот (`candidate_event_map`)
- [ ] `parse-engine:workspace:heal --dry-run` → план без SQL
- [ ] `parse-engine:reset` / `clearParseLayerArtifacts`: TRUNCATE workspace + parsed

### GF-P1

- [ ] GF-P1-01: фикстура `packages/shared/src/domain/parse/__fixtures__/gf-p1-01-taganrog.txt` — place candidate + `danger`
- [ ] GF-P1-03: orphan sweep (unit test)
- [ ] GF-P1-04: orchestrator даёт ≥1 materializable candidate

### Enrich-фаза

- [ ] catalog baseline → llm enrich: evloc не затирается при пустом llm delta (enrich test)

### Документация

- [ ] [geo-clean-rebuild.md](../../runbook/geo-clean-rebuild.md) — `message_parse_workspace`, heal
- [ ] `wipeLog` — workspace в плане system:wipe

---

## Известные хвосты (не блокер приёмки P1–P4)

| Тема | Статус |
|------|--------|
| `deriveRegionFromPlace` в finalizer (ADR-012 §8.1) | ✅ P6 — `buildMaterializedEventLocations` |
| `parsePost` / classifier в `channelIngestAudit`, `evalShared.loadFixtureBlocks` | legacy read-only |
| Per-candidate eventType из block-context | v1: `all_candidates` (EventTypeProcessor) |
| ODP parser-rules pack | fallback `extractEventType.ts` |

---

## Коммиты (рекомендуемая нарезка)

1. `feat(parse): shared schemas + migration message_parse_workspace`
2. `feat(parse): workspace orchestrator, finalizer, persist`
3. `feat(parse): wire handler, phase runner, heal CLI`
4. `feat(parse): CLI SSOT (snap/report/eval) + processors registry`
5. `test(parse): GF-P1 fixtures + finalizer unit tests`
6. `docs(parse): implementation plan + runbook workspace`
