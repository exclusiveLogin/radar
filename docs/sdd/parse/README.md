# Parse Workspace — SDD

Статус: **P1–P4 реализовано в коде** (2026-06-16) · [план приёмки](./implementation-plan.md)  
База: [parse-processor-workspace.md](../../rfc/parse-processor-workspace.md) · Индекс SDD: [../README.md](../README.md)

---

## Индекс фаз

| Фаза | SDD | Статус | Коммиты |
|------|-----|--------|---------|
| **P0** | — (RFC ✅) | ✅ | — |
| **P1** | [phase-p1-workspace-finalizer.md](./phase-p1-workspace-finalizer.md) | ✅ код | 3–4 |
| **P2** | [phase-p2-trait-processors.md](./phase-p2-trait-processors.md) | ✅ код | 2 |
| **P3** | [phase-p3-processor-registry.md](./phase-p3-processor-registry.md) | ✅ код | 2 |
| **P4** | [phase-p4-semantic-segmenter.md](./phase-p4-semantic-segmenter.md) | ✅ код | 2+ |
| **P5** | — (legacy removal) | 🔶 частично | 1 |
| **P6** | [phase-p6-geo-db-scan.md](./phase-p6-geo-db-scan.md) | ✅ код | ADR-012 |

**Приёмка:** [implementation-plan.md](./implementation-plan.md) — чеклист проверки.

---

## Целевой поток

```text
raw → grooming → processors → ParseWorkspace → finalize → parsed_events
                      ↑              ↑
                 ODP parser-rules   message_parse_workspace (P1)
```

---

## Связи

| Parse | Другой поток |
|-------|--------------|
| P1 EventTypeProcessor | ODP D1 parser-rules pack |
| P1 finalize → facts | Tracking T1 input |
| P1 + ADR-012 | geo scan без place_aliases | ✅ P6 |

Рекомендация: **P1 параллельно Tracking T1 + ODP D1**.

---

## Открытые решения (из RFC)

См. [parse-processor-workspace.md § открытые вопросы](../../rfc/parse-processor-workspace.md#открытые-вопросы-для-следующей-сессии).  
P1 SDD фиксирует defaults для: orphanPolicy, stable match key, one active workspace per raw.
