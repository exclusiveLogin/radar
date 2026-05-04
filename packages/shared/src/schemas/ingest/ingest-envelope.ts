import { z } from "zod";
import { geoStructureSchema } from "./geo-structure";

/**
 * Сырой конверт сообщения для инжеста (текст + опциональная структура).
 * Hash/dedupe считаются отдельно в воркере (см. `ingestMessageHash`).
 */
export const ingestEnvelopeSchema = z.object({
  text: z.string(),
  structured: geoStructureSchema.optional(),
});

export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
