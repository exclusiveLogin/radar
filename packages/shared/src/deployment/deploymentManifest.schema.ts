/**
 * ---
 * layer: shared/deployment
 * domain: deployment
 * purpose: SSOT deployment.manifest.json — схемы, defaults и env overlay (без node:fs, browser-safe).
 * ---
 */
import { z } from "zod";
import { pipelineKeySchema, type PipelineKey } from "../schemas/admin/workbook.js";

/** Worker-role, на котором исполняется pipeline (см. RADAR_WORKER_ROLE). */
export const deploymentHostSchema = z.enum(["all", "ingest", "backfill", "phase", "tracking"]);
export type DeploymentHost = z.infer<typeof deploymentHostSchema>;

/** Способ поднятия workload: in-process или отдельный docker-сервис. */
export const deploymentSpawnSchema = z.enum(["in-process", "docker"]);
export type DeploymentSpawn = z.infer<typeof deploymentSpawnSchema>;

/** Реализация scheduler: legacy-демон или runner platform. */
export const schedulingImplSchema = z.enum(["legacy", "runner-platform"]);
export type SchedulingImpl = z.infer<typeof schedulingImplSchema>;

export const deploymentPipelineEntrySchema = z.object({
  pipelineKey: pipelineKeySchema,
  label: z.string(),
  host: deploymentHostSchema.default("all"),
  spawn: deploymentSpawnSchema.default("in-process"),
  schedulingImpl: schedulingImplSchema.default("legacy"),
  enabled: z.boolean().default(true),
});
export type DeploymentPipelineEntry = z.infer<typeof deploymentPipelineEntrySchema>;

export const deploymentRunnersSchema = z.object({
  pipelines: z.array(deploymentPipelineEntrySchema).default([]),
});
export type DeploymentRunners = z.infer<typeof deploymentRunnersSchema>;

export const deploymentInfraObsSchema = z.object({
  dockerize: z.boolean().default(false),
  dockerizeAll: z.boolean().default(false),
  mode: z.enum(["embedded", "service", "noop"]).optional(),
});
export type DeploymentInfraObs = z.infer<typeof deploymentInfraObsSchema>;

export const deploymentInfraSchema = z.object({
  obs: deploymentInfraObsSchema.default({}),
});
export type DeploymentInfra = z.infer<typeof deploymentInfraSchema>;

/** Зарезервировано под transport-sidecar (mtproxy и т.п.) — defaults пустые. */
export const deploymentTransportSchema = z.object({}).default({});
export type DeploymentTransport = z.infer<typeof deploymentTransportSchema>;

export const deploymentManifestSchema = z.object({
  version: z.literal(1).default(1),
  runners: deploymentRunnersSchema.default({ pipelines: [] }),
  infra: deploymentInfraSchema.default({ obs: {} }),
  transport: deploymentTransportSchema.default({}),
});
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

/** Дефолтный manifest — parity с ODP_MANIFEST / docker split roles. */
export const DEFAULT_DEPLOYMENT_MANIFEST: DeploymentManifest = deploymentManifestSchema.parse({
  version: 1,
  runners: {
    pipelines: [
      {
        pipelineKey: "tracking",
        label: "NextGen track rebuild (cluster+field_train+join)",
        host: "tracking",
        spawn: "in-process",
        schedulingImpl: "legacy",
        enabled: true,
      },
      {
        pipelineKey: "parse",
        label: "ingestParse scheduled phases (queue_parse_coverage claim-drain)",
        host: "phase",
        spawn: "in-process",
        schedulingImpl: "legacy",
        enabled: true,
      },
      {
        pipelineKey: "geo-enrich",
        label: "geoParse scheduled phases (dadata → nominatim → llm)",
        host: "phase",
        spawn: "in-process",
        schedulingImpl: "legacy",
        enabled: true,
      },
    ],
  },
  infra: {
    obs: { dockerize: false, dockerizeAll: false },
  },
  transport: {},
});

const LEGACY_RUNNER_ENV: Record<PipelineKey, string> = {
  tracking: "TRACKING_RUNNER_PLATFORM_ENABLED",
  parse: "PARSE_RUNNER_PLATFORM_ENABLED",
  "geo-enrich": "GEO_ENRICH_RUNNER_PLATFORM_ENABLED",
};

function pipelineKeyFromEnvSuffix(suffix: string): PipelineKey | undefined {
  const normalized = suffix.toLowerCase().replace(/-/g, "_");
  if (normalized === "tracking") return "tracking";
  if (normalized === "parse") return "parse";
  if (normalized === "geo_enrich" || normalized === "geoenrich") return "geo-enrich";
  return undefined;
}

function envTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Overlay DEPLOY_* / legacy runner flags / deployment.local.json поверх base manifest. */
export function applyDeploymentEnvOverlay(
  manifest: DeploymentManifest,
  env: NodeJS.ProcessEnv = process.env,
): DeploymentManifest {
  let result = manifest;

  const obsPatch: Partial<DeploymentInfraObs> = {};
  if (envTruthy(env.DEPLOY_OBS_DOCKERIZE)) obsPatch.dockerize = true;
  if (envTruthy(env.DEPLOY_OBS_DOCKERIZE_ALL)) obsPatch.dockerizeAll = true;
  if (env.DEPLOY_OBS_MODE?.trim()) {
    obsPatch.mode = env.DEPLOY_OBS_MODE.trim() as DeploymentInfraObs["mode"];
  }
  if (Object.keys(obsPatch).length > 0) {
    result = {
      ...result,
      infra: { ...result.infra, obs: { ...result.infra.obs, ...obsPatch } },
    };
  }

  const pipelinePatches = new Map<PipelineKey, Partial<DeploymentPipelineEntry>>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("DEPLOY_PIPELINE_") || value == null) continue;
    const rest = key.slice("DEPLOY_PIPELINE_".length);
    const sep = rest.lastIndexOf("_");
    if (sep <= 0) continue;
    const pipelineKey = pipelineKeyFromEnvSuffix(rest.slice(0, sep));
    if (!pipelineKey) continue;
    const field = rest.slice(sep + 1).toLowerCase();
    const patch = pipelinePatches.get(pipelineKey) ?? {};
    if (field === "scheduling") {
      patch.schedulingImpl = value.trim() as SchedulingImpl;
    } else if (field === "host") {
      patch.host = value.trim() as DeploymentHost;
    } else if (field === "spawn") {
      patch.spawn = value.trim() as DeploymentSpawn;
    } else if (field === "enabled") {
      patch.enabled = envTruthy(value);
    }
    pipelinePatches.set(pipelineKey, patch);
  }

  const pipelines = result.runners.pipelines.map((entry) => {
    let next = { ...entry, ...(pipelinePatches.get(entry.pipelineKey) ?? {}) };
    const legacyFlag = LEGACY_RUNNER_ENV[entry.pipelineKey];
    if (env[legacyFlag] === "true") {
      next = { ...next, schedulingImpl: "runner-platform" };
    }
    return next;
  });

  return deploymentManifestSchema.parse({
    ...result,
    runners: { pipelines },
  });
}

/** Подмешивает infra.obs в process.env (DOCKERIZE_OBS/ALL, RADAR_OBS_MODE) если не заданы. */
export function applyDeploymentInfraEnv(
  manifest: DeploymentManifest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const obs = manifest.infra.obs;
  if (obs.dockerize && env.DOCKERIZE_OBS == null) env.DOCKERIZE_OBS = "1";
  if (obs.dockerizeAll && env.DOCKERIZE_ALL == null) env.DOCKERIZE_ALL = "1";
  if (obs.mode && env.RADAR_OBS_MODE == null) env.RADAR_OBS_MODE = obs.mode;
}
