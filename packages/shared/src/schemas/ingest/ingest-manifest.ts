import { z } from "zod";
import { createIngestBindingSchema, createIngestProviderSchema } from "./ingest-provider";
import { channelManifestEntrySchema } from "./channel-manifest";

/** Manifest v2 entry — dual SSOT staging для import/export. */
export const ingestManifestEntrySchema = z.object({
  persist: z.boolean().default(false),
  provider: createIngestProviderSchema.optional(),
  channel: channelManifestEntrySchema.optional(),
  binding: createIngestBindingSchema
    .omit({ channelKey: true, channelId: true })
    .extend({
      channelKey: z.string().min(1).optional(),
    })
    .optional(),
});

export const ingestManifestSchema = z.object({
  version: z.literal(2).default(2),
  entries: z.array(ingestManifestEntrySchema).default([]),
});

export type IngestManifestEntry = z.infer<typeof ingestManifestEntrySchema>;
export type IngestManifest = z.infer<typeof ingestManifestSchema>;
