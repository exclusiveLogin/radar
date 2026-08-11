/**
 * ---
 * layer: shared/pipeline
 * purpose: Генерация docs/reference/pipeline-triggers.md из pipeline.manifest + system keys.
 *          Ручная правка справочника запрещена — только через этот генератор + snapshot-тест.
 * ---
 */
import type { PipelineManifest, StepDescriptor } from "./pipelineManifest.schema.js";
import {
  buildTopicCatalog,
  listSystemTopicRoutingKeys,
  RADAR_TOPICS,
} from "../transport/topicCatalog.js";

/** Известные владельцы payload-схемы (SSOT-комментарий для справочника). */
const PAYLOAD_OWNERS: Record<string, string> = {
  [RADAR_TOPICS.RAW_INGESTED]: "RawMessageIngested / ingest handlers",
  [RADAR_TOPICS.MESSAGE_PARSED]: "MessageParsed / parse step egress",
  [RADAR_TOPICS.GEO_ENRICH_REQUEST]: "geo enrich request (admin/CLI / geo queue)",
  [RADAR_TOPICS.PARSE_STABILIZED]: "PipelineStabilized / parse stability cascade",
  [RADAR_TOPICS.GEO_STABILIZED]: "PipelineStabilized / geo (reserved, no tracking wake)",
  [RADAR_TOPICS.CHANNEL_BACKFILL_COMPLETED]: "ChannelBackfillCompleted / backfill daemon",
  [RADAR_TOPICS.STEP_RUN_REQUESTED]: "StepRunRequested / admin+CLI",
  [RADAR_TOPICS.STEP_RESET_REQUESTED]: "StepResetRequested / admin+CLI",
  [RADAR_TOPICS.STEP_STARTED]: "StepStarted / StepRunner lifecycle",
  [RADAR_TOPICS.STEP_DRAINED]: "StepDrained / StepRunner lifecycle",
  [RADAR_TOPICS.STEP_FAILED]: "StepFailed / StepRunner lifecycle",
  [RADAR_TOPICS.SYSTEM_INIT]: "SystemInit / worker boot",
  [RADAR_TOPICS.SYSTEM_DRAIN]: "SystemDrain / shutdown",
  [RADAR_TOPICS.RUNNER_DRAIN_PARSE]: "runner drain signal (parse)",
  [RADAR_TOPICS.RUNNER_DRAIN_GEO]: "runner drain signal (geo)",
  [RADAR_TOPICS.RUNNER_DRAIN_TRACKING]: "runner drain signal (tracking)",
  [RADAR_TOPICS.RUNNER_CONTROL]: "runner control signal",
};

function publishersForKey(manifest: PipelineManifest, key: string): string[] {
  const fromSteps = manifest.steps
    .filter((s) => s.emits.includes(key))
    .map((s) => `step:${s.id}`);
  if (fromSteps.length) return fromSteps;
  if (key.startsWith("radar.system.")) return ["system:boot/shutdown"];
  if (key.startsWith("radar.step.")) return ["system:StepRunner / admin"];
  if (key.startsWith("radar.runner.")) return ["system:runner drain/control"];
  if (key === RADAR_TOPICS.GEO_ENRICH_REQUEST) return ["external:geo request (admin/CLI)"];
  return ["unknown"];
}

function consumersForKey(manifest: PipelineManifest, key: string): StepDescriptor[] {
  return manifest.steps.filter((s) => s.trigger.on.includes(key));
}

function formatGates(step: StepDescriptor): string {
  const lanes = step.trigger.accepts.lane;
  const laneGate = lanes?.length ? `lane∈[${lanes.join(",")}]` : "lane:any";
  return `${laneGate}; debounceMs=${step.trigger.debounceMs}; isolate→только target stepId`;
}

function isSystemKey(key: string): boolean {
  return (
    key.startsWith("radar.system.") ||
    key.startsWith("radar.step.") ||
    key.startsWith("radar.runner.")
  );
}

/**
 * Собирает markdown-справочник триггеров.
 * Детерминирован: сортировка ключей и шагов стабильна для snapshot-теста.
 */
export function generatePipelineTriggersDoc(manifest: PipelineManifest): string {
  const catalog = buildTopicCatalog(manifest);
  const systemOnly = new Set(listSystemTopicRoutingKeys());
  const lines: string[] = [];

  lines.push("# Pipeline triggers (generated)");
  lines.push("");
  lines.push("> **Автогенерация.** Источник: `pipeline.manifest.json` + `listSystemTopicRoutingKeys()`.");
  lines.push("> Не редактировать вручную. Пересобрать: `generatePipelineTriggersDoc(loadPipelineManifest(...))`.");
  lines.push("");
  lines.push("## Модель");
  lines.push("");
  lines.push("- Цепочка шагов = совпадение `emits[]` → `trigger.on[]` (граф в `buildPipelineGraph`).");
  lines.push("- Ingress: `StepTriggerRouter` (lane / isolate / stepId).");
  lines.push("- Egress: `StepEgressGate` (whitelist emits; isolate подавляет domain emits).");
  lines.push("");

  lines.push("## Keys");
  lines.push("");

  for (const key of catalog) {
    const publishers = publishersForKey(manifest, key);
    const consumers = consumersForKey(manifest, key);
    const owner = PAYLOAD_OWNERS[key] ?? "(open / step-local payload)";
    const role = isSystemKey(key)
      ? "system"
      : systemOnly.has(key) && !manifest.steps.some((s) => s.emits.includes(key) || s.trigger.on.includes(key))
        ? "system-catalog"
        : "domain";

    lines.push(`### \`${key}\``);
    lines.push("");
    lines.push(`- **role:** ${role}`);
    lines.push(`- **publishers:** ${publishers.join(", ")}`);
    if (consumers.length === 0) {
      lines.push("- **consumers:** _(none in manifest — terminal or lifecycle)_");
    } else {
      lines.push("- **consumers:**");
      for (const c of consumers) {
        lines.push(`  - \`${c.id}\` (${c.pipelineKey}) — ${formatGates(c)}`);
      }
    }
    lines.push(`- **payload schema owner:** ${owner}`);
    lines.push("- **lane / isolate:** lane из `meta.lane` → `payload.ingestMode` → `live`; isolate на ingress режет чужие шаги, на egress глушит domain emits.");
    lines.push("");
  }

  lines.push("## System lifecycle keys");
  lines.push("");
  lines.push("| Key | Auto-emitted by |");
  lines.push("|-----|-----------------|");
  lines.push(`| \`${RADAR_TOPICS.SYSTEM_INIT}\` | worker boot (\`createSystemInitEvent\`) |`);
  lines.push(`| \`${RADAR_TOPICS.SYSTEM_DRAIN}\` | shutdown (\`createSystemDrainEvent\`) |`);
  lines.push(`| \`${RADAR_TOPICS.STEP_RUN_REQUESTED}\` | admin / CLI |`);
  lines.push(`| \`${RADAR_TOPICS.STEP_RESET_REQUESTED}\` | admin / CLI |`);
  lines.push(`| \`${RADAR_TOPICS.STEP_STARTED}\` | StepRunner (bypass isolate) |`);
  lines.push(`| \`${RADAR_TOPICS.STEP_DRAINED}\` | StepRunner (bypass isolate) |`);
  lines.push(`| \`${RADAR_TOPICS.STEP_FAILED}\` | StepRunner (bypass isolate) |`);
  lines.push("");
  lines.push("## Steps snapshot");
  lines.push("");
  lines.push("| id | kind | trigger.on | emits | resets.handler |");
  lines.push("|----|------|------------|-------|----------------|");
  for (const s of [...manifest.steps].sort((a, b) => a.id.localeCompare(b.id))) {
    const on = s.trigger.on.join(", ") || "—";
    const emits = s.emits.length ? s.emits.join(", ") : "_(terminal)_";
    const handler = s.resets?.handler ?? "—";
    lines.push(`| \`${s.id}\` | ${s.kind} | ${on} | ${emits} | ${handler} |`);
  }
  lines.push("");

  return lines.join("\n");
}
