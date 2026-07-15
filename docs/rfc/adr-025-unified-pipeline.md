# ADR-025: Unified pipeline — north star

## Status

Accepted (2026-07-14) — D3 gate passed. PhaseDriver wiring (2026-07-15).

## Context

Parse/geo/tracking pipelines использовали параллельные пути: legacy-демоны, sync CoverageEnqueuer, queue_parse_coverage как message-copy, schedulingImpl dual-path.

См. ADR-003, ADR-016, ADR-021, ADR-022, ADR-023.

## Glossary

| Term | Role |
|------|------|
| Workbook | Чертёж: descriptor + `evaluate` |
| Workload | Инферинг wb: schedule/wake/lock + IO ports |
| PhaseDriver | SSOT фабрика фазы: `queue` + `runItem` + `schedule` |
| IWorkQueue | Порт job-таблицы: plan → claimBatch → mark* |
| UnifiedRunner | Один оборот жерновов (`drainOnce` = 1 batch) |

## Decision

### Три плоскости

| Plane | Tables | Role |
|-------|--------|------|
| Config | phase_definitions | WHAT to run |
| Execution | job_*, mat_* | truth of work |
| Obs | log_phase_run, workload | UI only |

### Unified loop

```
triggerMode wake/timeout
  → Workload.tick
  → loadSlice gate
  → evaluate: buildPhaseDriver → UnifiedRunner.drainOnce (×1)
  → planPending → claimBatch → runItem → mark*
```

Докачка очереди = следующие тики (RMQ wake / interval / coalesced pendingWakeup), не `drainUntilEmpty` внутри evaluate.

### triggerMode → ScheduleMode

| triggerMode | schedule | RMQ wake |
|-------------|----------|----------|
| event | event | yes |
| timeout | interval | no |
| both | hybrid | yes |
| manual | event | no |

SSOT: `phaseDriver.triggerModeToSchedule`. RMQ subscribe: `phaseWakeScheduler` (`event\|both`).

### Manifest → DB → runtime

deployment.manifest.json → stack bootstrap → phase_definitions; runtime reads DB only.

`buildPhaseDriver(phase, deps)` в коде по scope (не в manifest).

## Invariants

1. Single loop per scope
2. No message-copy on ingest — RMQ ids → planPending
3. Execution SSOT = jobs + artifacts
4. maxAttempts/retryFailed in phase.policy
5. transport_dedup wake dedup
6. RMQ payload: materializationIds/placeIds, mode targeted\|full
7. WorkItemOutcome: completed\|failed\|skipped
8. DB-only runtime post bootstrap
9. Runner-platform only
10. Role-driven boot
11. One `drainOnce` per Workload tick

## Sunset (D3 gate)

- queue_parse_coverage → job_parse_phase
- log_parse_phase_run → log_phase_run
- Remove legacy daemons, schedulingImpl legacy, sync CoverageEnqueuer
- trigger → triggerMode; phase.manifest → deployment.phases
- HandlerRegistry / orphan parsePhaseWorkload / geoEnrichRunner → PhaseDriver
- IWorkClaim → IWorkQueue

## Consequences

Admin catch-up SQL + drain; radar stack bootstrap CLI.

## D3 gate checklist

- [x] queue_parse_coverage → job_parse_phase (migration 1753100000000)
- [x] log_parse_phase_run → log_phase_run
- [x] schedulingImpl legacy removed — runner-platform only
- [x] IngestParseDaemon / PlaceEnrichmentDaemon / LegacyWorkloadAdapter deleted
- [x] CoverageEnqueuer sync removed from ingest hot path
- [x] transport_dedup PG + graceful RMQ shutdown
- [x] deployment.phases + stack bootstrap
- [x] PhaseWakeScheduler + drain payload mode full\|targeted
- [x] IWorkQueue + UnifiedRunner + PhaseDriver
- [x] triggerMode → ScheduleMode mapping
