/**
 * ---
 * layer: shared
 * kind: schema
 * domain: ingest
 * tooling: zod
 * purpose: Каноническая структура распарсенного события (write-side output).
 * ---
 */
import { z } from "zod";
import { eventLocationSchema } from "./event-location";
import { eventTypeSchema } from "./event-type";
import { macroZoneSchema } from "./macro-zone";
import { severitySchema } from "./severity";

export const parsedEventSchema = z.object({
  rawMessageId: z.string().uuid(),
  eventType: eventTypeSchema,
  severity: severitySchema,
  repeat: z.boolean().default(false),
  count: z.number().int().positive().optional(),
  direction: z.string().optional(),
  macroZone: macroZoneSchema.optional(),
  locations: z.array(eventLocationSchema),
  postedAt: z.string().datetime(),
  parserVersion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  extras: z.record(z.unknown()).default({}),
  /** false — не показывать на карте/ленте (LLM отверг после merge). */
  isActive: z.boolean().optional(),
  inactiveReason: z.string().min(1).optional(),
});

export type ParsedEvent = z.infer<typeof parsedEventSchema>;
