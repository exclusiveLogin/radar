/**
 * ---
 * layer: shared/deployment
 * domain: deployment
 * purpose: SSOT deployment.manifest.json — схемы и defaults (без node:fs, browser-safe).
 *          Env overlay — через loadDomainManifest + DEPLOY__* (ADR-021).
 * ---
 */
import { z } from "zod";
import { pipelineKeySchema } from "../schemas/admin/workbook.js";

/** Worker-role, на котором исполняется pipeline (см. RADAR_WORKER_ROLE). */
export const deploymentHostSchema = z.enum([
  "all",
  "ingest",
  "backfill",
  "parse",
  "geo",
  "tracking",
  /** @deprecated — use parse/geo */
  "phase",
]);
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

export const deploymentProcessSchema = z.object({
  role: z
    .enum(["all", "ingest", "backfill", "parse", "geo", "tracking", "phase"])
    .default("all"),
  storageMode: z.enum(["memory", "db", "fs"]).default("db"),
});
export type DeploymentProcess = z.infer<typeof deploymentProcessSchema>;

export const deploymentInfraObsSchema = z.object({
  mode: z.enum(["embedded", "service", "noop"]).default("embedded"),
  readMode: z.enum(["embedded", "service"]).default("embedded"),
  serviceUrl: z.string().default("http://127.0.0.1:3020"),
  dockerize: z.boolean().default(false),
  dockerizeAll: z.boolean().default(false),
  port: z.number().int().positive().default(3020),
  host: z.string().default("0.0.0.0"),
  staleMs: z.number().int().positive().default(120_000),
  staleIntervalMs: z.number().int().positive().default(30_000),
});
export type DeploymentInfraObs = z.infer<typeof deploymentInfraObsSchema>;

export const deploymentInfraComposeSchema = z.object({
  apiPort: z.number().int().positive().default(3000),
  webPort: z.number().int().positive().default(5173),
});
export type DeploymentInfraCompose = z.infer<typeof deploymentInfraComposeSchema>;

export const deploymentInfraSchema = z.object({
  obs: deploymentInfraObsSchema.default({}),
  compose: deploymentInfraComposeSchema.default({}),
});
export type DeploymentInfra = z.infer<typeof deploymentInfraSchema>;

export const deploymentTransportKindSchema = z.enum(["in-process", "rmq"]);
export type DeploymentTransportKind = z.infer<typeof deploymentTransportKindSchema>;

export const deploymentTransportRmqSchema = z.object({
  url: z.string().default("amqp://radar:radar@127.0.0.1:5672/radar"),
  exchange: z.string().default("radar.events"),
  prefetch: z.number().int().positive().default(10),
  dedupTable: z.boolean().default(true),
});
export type DeploymentTransportRmq = z.infer<typeof deploymentTransportRmqSchema>;

export const deploymentTransportSchema = z.object({
  kind: deploymentTransportKindSchema.default("in-process"),
  rmq: deploymentTransportRmqSchema.default({}),
});
export type DeploymentTransport = z.infer<typeof deploymentTransportSchema>;

export const deploymentManifestSchema = z.object({
  version: z.literal(1).default(1),
  process: deploymentProcessSchema.default({}),
  runners: deploymentRunnersSchema.default({ pipelines: [] }),
  infra: deploymentInfraSchema.default({ obs: {}, compose: {} }),
  transport: deploymentTransportSchema.default({}),
});
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

/** Дефолтный manifest — parity с docker split roles. */
export const DEFAULT_DEPLOYMENT_MANIFEST: DeploymentManifest = deploymentManifestSchema.parse({
  version: 1,
  process: { role: "all", storageMode: "db" },
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
        label: "ingestParse scheduled phases (RMQ drain)",
        host: "parse",
        spawn: "in-process",
        schedulingImpl: "legacy",
        enabled: true,
      },
      {
        pipelineKey: "geo-enrich",
        label: "geoParse scheduled phases (dadata → nominatim → llm)",
        host: "geo",
        spawn: "in-process",
        schedulingImpl: "legacy",
        enabled: true,
      },
    ],
  },
  infra: {
    obs: {
      mode: "embedded",
      readMode: "embedded",
      serviceUrl: "http://127.0.0.1:3020",
      dockerize: false,
      dockerizeAll: false,
      port: 3020,
      host: "0.0.0.0",
      staleMs: 120_000,
      staleIntervalMs: 30_000,
    },
    compose: { apiPort: 3000, webPort: 5173 },
  },
  transport: {
    kind: "in-process",
    rmq: {
      url: "amqp://radar:radar@127.0.0.1:5672/radar",
      exchange: "radar.events",
      prefetch: 10,
      dedupTable: true,
    },
  },
});
