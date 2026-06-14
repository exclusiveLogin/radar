# SDD: Parse — Фаза P3 — Processor registry

Статус: **ready for implementation**  
RFC: [parse-processor-workspace.md](../../rfc/parse-processor-workspace.md)

**Критерий входа:** P2 trait processors stable.

---

## 1. Scope / Out of scope

### In scope

- `ProcessorRegistry` — ordered list, enable/disable, revision id
- `ParseProcessor` interface (run(ctx) → void)
- Config file `parse-processors.v1.yaml` (bundled)
- `parser_revision` on workspace row from registry hash
- CLI `parse-engine:processors:list`, `parse-engine:processors:validate`

### Out of scope

- Hot-reload registry without worker restart
- Per-channel processor overrides (v2)
- LLM processor in registry (lazy phase — separate adapter)

---

## 2. Контракты

### 2.1 Processor interface

```typescript
export type ParseProcessorContext = {
  workspace: ParseWorkspace;
  domainProfile: DomainProfileContext;  // ODP D2
  logger: Logger;
};

export interface ParseProcessor {
  readonly id: string;
  readonly order: number;
  run(ctx: ParseProcessorContext): Promise<void> | void;
}
```

### 2.2 Registry config

```yaml
schemaVersion: 1
revision: "2026-06-14.1"
processors:
  - id: geo-spawn
    impl: GeoProcessor
    enabled: true
    order: 10
  - id: event-type
    impl: EventTypeProcessor
    enabled: true
    order: 20
  - id: repeat-trait
    impl: RepeatProcessor
    enabled: true
    order: 30
  # ...
```

Path: `data/domains/uav_osint_ru_v1/parse-processors.v1.yaml` or `packages/worker/config/`.

### 2.3 Registry SSOT

```typescript
export function loadProcessorRegistry(path: string): ProcessorRegistry;
export function runProcessorPipeline(
  workspace: ParseWorkspace,
  registry: ProcessorRegistry,
  ctx: Omit<ParseProcessorContext, "workspace">,
): Promise<ParseWorkspace>;
```

---

## 3. Revision / supersede

When `parser_revision` changes on re-parse:

1. Mark old workspace `superseded`
2. New workspace run with new revision
3. Finalize with heal — orphan sweep old `spawned_event_ids`

---

## 4. Adding new processor (DoD pattern)

1. Implement `ParseProcessor`
2. Register in YAML
3. Bump `revision`
4. Golden fixture
5. Heal channel batch (optional)

No changes to `ParseFinalizerService` core.

---

## 5. DoD checklist

- [ ] Pipeline driven by registry, not hardcoded array
- [ ] `parser_revision` persisted on workspace
- [ ] validate CLI catches unknown impl / duplicate order
- [ ] Disable processor via YAML skips step
- [ ] Document add-processor checklist in [parse README](./README.md)

---

## 6. Коммиты

| # | Содержание |
|---|------------|
| C1 | interface + registry loader + runPipeline |
| C2 | YAML config + migrate hardcoded order + CLI |
