/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Контракты WebSocket-канала админки (/ws/admin): телеметрия, parse-лог, backfill.
 * ---
 */
import { z } from "zod";
import { workerStatusResponseSchema } from "../worker-status";
import { backfillJobListItemSchema } from "./backfill";
import { parseAttemptItemSchema } from "./parse-attempt";
import { phaseRunsOverviewSchema } from "../enrichment/phase-admin";
import { phaseRunSchema } from "../enrichment/phase-run";
import { trackingStatusResponseSchema } from "./tracking";
import { parsePipelineStatusResponseSchema } from "./parse-pipeline";
import { runnerDiscoveryResponseSchema } from "./runner-discovery";

export const adminWsChannelSchema = z.enum([
  "worker-status",
  "parse-log",
  "backfill-progress",
  "phases-update",
  "tracking-status",
  "parse-pipeline-status",
  "runtime-discovery",
]);

/** Сообщение клиента: подписка/отписка на набор каналов админки. */
export const adminWsClientMessageSchema = z.object({
  type: z.enum(["subscribe", "unsubscribe"]),
  channels: z.array(adminWsChannelSchema).min(1),
});

/** Payload phases-update: текущий overview + последние runs. */
export const phasesUpdatePayloadSchema = z.object({
  overview: phaseRunsOverviewSchema,
  runs: z.array(phaseRunSchema),
});
export type PhasesUpdatePayload = z.infer<typeof phasesUpdatePayloadSchema>;

/** Сообщения сервера админ-WS (discriminated union по `type`). */
export const adminWsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worker-status"), payload: workerStatusResponseSchema }),
  z.object({ type: z.literal("parse-log"), payload: parseAttemptItemSchema }),
  z.object({ type: z.literal("backfill-progress"), payload: backfillJobListItemSchema }),
  z.object({ type: z.literal("phases-update"), payload: phasesUpdatePayloadSchema }),
  z.object({ type: z.literal("tracking-status"), payload: trackingStatusResponseSchema }),
  z.object({
    type: z.literal("parse-pipeline-status"),
    payload: parsePipelineStatusResponseSchema,
  }),
  z.object({ type: z.literal("runtime-discovery"), payload: runnerDiscoveryResponseSchema }),
]);

export type AdminWsChannel = z.infer<typeof adminWsChannelSchema>;
export type AdminWsClientMessage = z.infer<typeof adminWsClientMessageSchema>;
export type AdminWsServerMessage = z.infer<typeof adminWsServerMessageSchema>;
