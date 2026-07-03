# SDD — Software Design Documents

Статус: **ready for implementation** (2026-06-14)

Пошаговые спецификации реализации по потокам. Архитектура и vision — в [RFC](../rfc/), [ADR](../adr-014-operational-domain-profile.md), [plan.md](../plan.md).  
Единая карта зависимостей: [master-implementation-roadmap.md](../rfc/master-implementation-roadmap.md).

---

## Индекс потоков

| Поток | SDD | База (RFC / ADR) | Фазы |
|-------|-----|------------------|------|
| **Tracking** | [tracking/](./tracking/README.md) | [plan.md](./tracking/plan.md), ADR 007–013 | T1, T2, T2b, T2c, T3, T4 |
| **ODP** | [odp/](./odp/README.md) | [ADR-014](../adr-014-operational-domain-profile.md), [walkthrough](../rfc/operational-domain-profile-walkthrough.md) | D1–D7 |
| **Parse** | [parse/](./parse/README.md) | [parse-processor-workspace](../rfc/parse-processor-workspace.md) | P1–P4 |
| **Runner platform** | [runner-platform/](./runner-platform/README.md) | [ADR-016](../adr-016-runner-platform.md) | Wave 1–8 (cross-context: tracking/parse/geo-enrich) |

---

## Рекомендуемый порядок (волна 1)

```text
Tracking T1  +  ODP D1  +  (опц.) Parse P1   — параллельно
```

Дальше: [master-implementation-roadmap.md § cross-stream](../rfc/master-implementation-roadmap.md#рекомендуемый-порядок-работ-cross-stream).

---

## Структура каталога

```text
docs/sdd/
  README.md           ← этот индекс
  tracking/
    README.md
    plan.md           ← work packages, golden fixtures
    phase-*.md
  odp/
    README.md
    phase-d*.md
  parse/
    README.md
    phase-p*.md
  runner-platform/
    README.md         ← cross-context: workbook/runner platform (ADR-016)
    runbook.md
    release-checklist.md
```
