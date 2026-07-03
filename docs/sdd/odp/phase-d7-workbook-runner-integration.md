# D7 — Workbook/Runner platform ↔ ODP integration

Статус: минимальный срез реализован (2026-07-02) — `odpManifest` + `odpResolve()`, только чтение feature-флагов.
База: [ADR-014](../../adr-014-operational-domain-profile.md) · [ADR-016 runner platform](../../adr-016-runner-platform.md) · Индекс: [../README.md](../README.md)

---

## Зачем этот файл

D1–D6 — доменная часть ODP (parser-rules, threat-profile, UI presets, event-типы). D7 фиксирует **единственную** точку пересечения ODP с runner platform/workbook (Wave 1–6 из `tracking-parse-architecture-refactor`), чтобы не создавать вторую несвязанную сущность с тем же именем.

## Что реализовано сейчас

`packages/worker/src/composition/odp/`:

```typescript
// odpManifest.ts
export type OdpPipelineKey = "tracking" | "parse" | "geo-enrich";
export type OdpManifestEntry = {
  pipelineKey: OdpPipelineKey;
  label: string;
  runnerPlatformEnabled: () => boolean; // is...RunnerPlatformEnabled() из соответствующего раннера
};

// odpResolve.ts
export function odpResolve(manifest = ODP_MANIFEST): OdpResolution[] {
  return manifest.map((entry) => ({
    pipelineKey: entry.pipelineKey,
    label: entry.label,
    runtime: entry.runnerPlatformEnabled() ? "runner-platform" : "legacy",
  }));
}
```

Используется в `createWorkerCompositionRoot.ts` только для лога при старте воркера (`[odp] tracking → runner-platform (...)`). **Не участвует** в конструировании раннеров — выбор legacy/runner-platform по-прежнему делает сам composition root (флаг читается напрямую).

## Что НЕ реализовано (осознанно, без отдельного согласования не делать)

- Пайплайн-конфигурация (какой раннер активен, флаги фаз) **не является полем** `OperationalDomainProfile`/`profile.manifest.json` (ADR-014). Сейчас это два независимых источника: content-конфигурация домена (ADR-014, D1-D6) и runtime-конфигурация раннеров (env-флаги, `odpManifest`).
- `odpResolve()` не строит `WorkbookInstance[]` — возвращает только `{ pipelineKey, runtime, label }` для лога/будущего admin UI, а не исполняемые объекты.
- Нет UI, который показывает `odpResolve()` result — Admin/Web UI Workbook Observability (`WorkbookObservabilityWidget`) берёт данные из `TrackingAdminService`/`PhasesAdminService`, не из `odpResolve()`.

## Возможное будущее слияние (не в scope Wave 1-8)

Если позже потребуется, чтобы конкретный `OperationalDomainProfile` (например, `uav_osint_ru_v1`) декларировал "использовать runner platform для tracking, legacy для geo-enrich" как часть своего манифеста — это отдельное решение с отдельным продуктовым обоснованием (сейчас это глобальный env-флаг процесса, не per-profile). Не закладывается в план заранее.
