# Pipeline triggers (generated)

> **Автогенерация.** Источник: `pipeline.manifest.json` + `listSystemTopicRoutingKeys()`.
> Не редактировать вручную. Пересобрать: `generatePipelineTriggersDoc(loadPipelineManifest(...))`.

## Модель

- Цепочка шагов = совпадение `emits[]` → `trigger.on[]` (граф в `buildPipelineGraph`).
- Ingress: `StepTriggerRouter` (lane / isolate / stepId).
- Egress: `StepEgressGate` (whitelist emits; isolate подавляет domain emits).

## Keys

### `radar.channel.backfill.completed`

- **role:** domain
- **publishers:** step:ingest-backfill
- **consumers:**
  - `parse` (parse) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** ChannelBackfillCompleted / backfill daemon
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.geo.enrich.request`

- **role:** domain
- **publishers:** external:geo request (admin/CLI)
- **consumers:**
  - `geo-enrich` (geo-enrich) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** geo enrich request (admin/CLI / geo queue)
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.geo.stabilized`

- **role:** system-catalog
- **publishers:** unknown
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** PipelineStabilized / geo (reserved, no tracking wake)
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.message.parsed`

- **role:** domain
- **publishers:** step:parse
- **consumers:**
  - `tracking` (tracking) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** MessageParsed / parse step egress
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.parse.stabilized`

- **role:** domain
- **publishers:** step:parse
- **consumers:**
  - `tracking` (tracking) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** PipelineStabilized / parse stability cascade
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.raw.ingested`

- **role:** domain
- **publishers:** step:ingest-live, step:ingest-backfill
- **consumers:**
  - `parse` (parse) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** RawMessageIngested / ingest handlers
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.runner.control`

- **role:** system
- **publishers:** system:runner drain/control
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** runner control signal
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.runner.drain.geo`

- **role:** system
- **publishers:** system:runner drain/control
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** runner drain signal (geo)
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.runner.drain.parse`

- **role:** system
- **publishers:** system:runner drain/control
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** runner drain signal (parse)
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.runner.drain.tracking`

- **role:** system
- **publishers:** system:runner drain/control
- **consumers:**
  - `tracking` (tracking) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** runner drain signal (tracking)
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.step.drained`

- **role:** system
- **publishers:** system:StepRunner / admin
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** StepDrained / StepRunner lifecycle
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.step.failed`

- **role:** system
- **publishers:** system:StepRunner / admin
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** StepFailed / StepRunner lifecycle
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.step.reset.requested`

- **role:** system
- **publishers:** system:StepRunner / admin
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** StepResetRequested / admin+CLI
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.step.run.requested`

- **role:** system
- **publishers:** system:StepRunner / admin
- **consumers:**
  - `ingest-backfill` (ingest-backfill) — lane∈[backfill,manual]; debounceMs=0; isolate→только target stepId
  - `parse` (parse) — lane:any; debounceMs=250; isolate→только target stepId
  - `geo-enrich` (geo-enrich) — lane:any; debounceMs=250; isolate→только target stepId
  - `tracking` (tracking) — lane:any; debounceMs=250; isolate→только target stepId
- **payload schema owner:** StepRunRequested / admin+CLI
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.step.started`

- **role:** system
- **publishers:** system:StepRunner / admin
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** StepStarted / StepRunner lifecycle
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.system.drain`

- **role:** system
- **publishers:** system:boot/shutdown
- **consumers:** _(none in manifest — terminal or lifecycle)_
- **payload schema owner:** SystemDrain / shutdown
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

### `radar.system.init`

- **role:** system
- **publishers:** system:boot/shutdown
- **consumers:**
  - `ingest-live` (ingest-live) — lane∈[live]; debounceMs=0; isolate→только target stepId
- **payload schema owner:** SystemInit / worker boot
- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.

## System lifecycle keys

| Key | Auto-emitted by |
|-----|-----------------|
| `radar.system.init` | worker boot (`createSystemInitEvent`) |
| `radar.system.drain` | shutdown (`createSystemDrainEvent`) |
| `radar.step.run.requested` | admin / CLI |
| `radar.step.reset.requested` | admin / CLI |
| `radar.step.started` | StepRunner (bypass isolate) |
| `radar.step.drained` | StepRunner (bypass isolate) |
| `radar.step.failed` | StepRunner (bypass isolate) |

## Steps snapshot

| id | kind | trigger.on | emits | resets.handler |
|----|------|------------|-------|----------------|
| `geo-enrich` | queue | radar.geo.enrich.request, radar.step.run.requested | _(terminal)_ | geo |
| `ingest-backfill` | source | radar.step.run.requested | radar.channel.backfill.completed, radar.raw.ingested | ingest |
| `ingest-live` | source | radar.system.init | radar.raw.ingested | ingest |
| `parse` | queue | radar.raw.ingested, radar.channel.backfill.completed, radar.step.run.requested | radar.message.parsed, radar.parse.stabilized | parse |
| `tracking` | queue | radar.message.parsed, radar.parse.stabilized, radar.step.run.requested, radar.runner.drain.tracking | _(terminal)_ | tracking |
