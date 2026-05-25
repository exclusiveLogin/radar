/**
 * Схемы ingest provider и binding — экземпляр дежурства и привязка к каналу.
 */
import { z } from "zod";
import {
  bindingModeSchema,
  ingestAdapterKindSchema,
  providerStatusSchema,
} from "./ingest-domain";
import { telegramAdapterConfigSchema } from "./telegram-adapter-config";

export const credentialRefsSchema = z.object({
  mtprotoSessionSlot: z.string().min(1).optional(),
  botTokenSlot: z.string().min(1).optional(),
  mtproxyProfile: z.string().min(1).optional(),
});

export const manualAdapterConfigSchema = z.object({
  kind: z.literal("manual"),
});

export const adapterConfigSchema = z.discriminatedUnion("kind", [
  telegramAdapterConfigSchema,
  manualAdapterConfigSchema,
]);

export const ingestBindingRecordSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  bindingKey: z.string().min(1),
  enabled: z.boolean(),
  externalTarget: z.string().min(1),
  bindingMode: bindingModeSchema,
  parseOverrides: z.record(z.unknown()).default({}),
  adapterBinding: z.record(z.unknown()).default({}),
});

export const ingestProviderRecordSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  title: z.string().min(1),
  adapterKind: ingestAdapterKindSchema,
  status: providerStatusSchema,
  adapterConfig: adapterConfigSchema,
  credentialRefs: credentialRefsSchema.default({}),
  lastError: z.string().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createIngestProviderSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  adapterKind: ingestAdapterKindSchema,
  adapterConfig: adapterConfigSchema,
  credentialRefs: credentialRefsSchema.optional(),
});

export const updateIngestProviderSchema = z.object({
  title: z.string().min(1).optional(),
  status: providerStatusSchema.optional(),
  adapterConfig: adapterConfigSchema.optional(),
  credentialRefs: credentialRefsSchema.optional(),
});

export const createIngestBindingSchema = z.object({
  bindingKey: z.string().min(1),
  channelKey: z.string().min(1).optional(),
  channelId: z.string().uuid().optional(),
  externalTarget: z.string().min(1),
  bindingMode: bindingModeSchema,
  enabled: z.boolean().default(true),
  parseOverrides: z.record(z.unknown()).optional(),
  adapterBinding: z.record(z.unknown()).optional(),
});

export type CredentialRefs = z.infer<typeof credentialRefsSchema>;
export type IngestBindingRecord = z.infer<typeof ingestBindingRecordSchema>;
export type IngestProviderRecord = z.infer<typeof ingestProviderRecordSchema>;
export type CreateIngestProvider = z.infer<typeof createIngestProviderSchema>;
export type UpdateIngestProvider = z.infer<typeof updateIngestProviderSchema>;
export type CreateIngestBinding = z.infer<typeof createIngestBindingSchema>;
