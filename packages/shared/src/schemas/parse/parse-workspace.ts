/**
 * Контракт Parse Workspace — промежуточная интерпретация raw до finalize в facts.
 */
import { z } from "zod";
import { attachRuleSchema } from "./trait-attachment.js";

export const messageBlockKindSchema = z.enum([
  "signal",
  "geo",
  "stats",
  "promo",
  "footer",
  "unknown",
]);

export const messageBlockSchema = z.object({
  id: z.string(),
  kind: messageBlockKindSchema,
  text: z.string(),
  span: z.object({ start: z.number(), end: z.number() }),
});

export const eventCandidateAnchorSchema = z.object({
  kind: z.enum(["place", "region", "system"]),
  name: z.string(),
  placeId: z.string().uuid().optional(),
  regionCode: z.string().optional(),
  placeFias: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  span: z.object({
    start: z.number(),
    end: z.number(),
    matchedText: z.string(),
  }),
});

export const eventCandidateSchema = z.object({
  id: z.string(),
  anchor: eventCandidateAnchorSchema,
  eventType: z.string(),
  occurredAt: z.string().datetime().optional(),
  extras: z.record(z.unknown()).default({}),
  provenance: z.object({
    eventTypeSource: z.string(),
    anchorSource: z.string(),
    blockId: z.string().optional(),
  }),
});

export const traitAttachmentSchema = z.object({
  id: z.string(),
  processorId: z.string(),
  traitKey: z.string(),
  value: z.unknown(),
  attachRule: attachRuleSchema,
  provenance: z
    .object({
      matchedText: z.string().optional(),
      span: z.object({ start: z.number(), end: z.number() }).optional(),
    })
    .optional(),
});

export const parseWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  rawMessageId: z.string().uuid(),
  groomedText: z.string(),
  blocks: z.array(messageBlockSchema),
  candidates: z.array(eventCandidateSchema),
  traitAttachments: z.array(traitAttachmentSchema).default([]),
  namespaces: z.record(z.unknown()).default({}),
  processorLog: z.array(
    z.object({
      id: z.string(),
      ok: z.boolean(),
      durationMs: z.number(),
    }),
  ),
});

export const messageParseWorkspaceStatusSchema = z.enum([
  "draft",
  "finalized",
  "superseded",
  "invalid",
]);

export const finalizeModeSchema = z.enum(["initial", "refinalize", "heal"]);

export const finalizeContextSchema = z.object({
  mode: finalizeModeSchema,
  existingSpawnedIds: z.array(z.string().uuid()),
  candidateEventMap: z.record(z.string().uuid()),
  orphanPolicy: z.enum(["deactivate", "hard_delete"]),
});

export const finalizeResultSchema = z.object({
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
  deactivated: z.number().int().min(0),
  deleted: z.number().int().min(0),
  spawnedEventIds: z.array(z.string().uuid()),
  candidateEventMap: z.record(z.string().uuid()),
});

export type MessageBlock = z.infer<typeof messageBlockSchema>;
export type EventCandidate = z.infer<typeof eventCandidateSchema>;
export type TraitAttachment = z.infer<typeof traitAttachmentSchema>;
export type ParseWorkspace = z.infer<typeof parseWorkspaceSchema>;
export type MessageParseWorkspaceStatus = z.infer<typeof messageParseWorkspaceStatusSchema>;
export type FinalizeMode = z.infer<typeof finalizeModeSchema>;
export type FinalizeContext = z.infer<typeof finalizeContextSchema>;
export type FinalizeResult = z.infer<typeof finalizeResultSchema>;
