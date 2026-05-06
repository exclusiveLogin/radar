import { z } from "zod";

export const statusDictionaryEntrySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  includeOnMap: z.boolean().default(true),
  parserHints: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(0).default(100),
});

export const statusDictionarySchema = z.object({
  version: z.literal(1).default(1),
  statuses: z.array(statusDictionaryEntrySchema),
});

export type StatusDictionaryEntry = z.infer<typeof statusDictionaryEntrySchema>;
export type StatusDictionary = z.infer<typeof statusDictionarySchema>;
