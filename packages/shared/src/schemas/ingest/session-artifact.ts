import { z } from "zod";

export const sessionKindSchema = z.enum(["mtproto_user", "bot_token"]);

export const sessionArtifactSchema = z.object({
  slotKey: z.string().min(1),
  kind: sessionKindSchema,
  providerKey: z.string().optional(),
  authorizedAt: z.string().datetime(),
  accountHint: z.string().optional(),
  schemaVersion: z.literal(1).default(1),
});

export const sessionDeployRequestSchema = z.object({
  slotKey: z.string().min(1),
  kind: sessionKindSchema,
  providerKey: z.string().optional(),
});

export const sessionProbeResultSchema = z.object({
  ok: z.boolean(),
  accountHint: z.string().optional(),
  error: z.string().optional(),
});

export type SessionKind = z.infer<typeof sessionKindSchema>;
export type SessionArtifact = z.infer<typeof sessionArtifactSchema>;
export type SessionDeployRequest = z.infer<typeof sessionDeployRequestSchema>;
export type SessionProbeResult = z.infer<typeof sessionProbeResultSchema>;

/** Материал сессии для adapter connect — secret + metadata. */
export type SessionMaterial = {
  slotKey: string;
  kind: SessionKind;
  secret: string;
  artifact: SessionArtifact;
};

export type SessionWriteInput = {
  kind: SessionKind;
  secret: string;
  providerKey?: string;
  accountHint?: string;
};
