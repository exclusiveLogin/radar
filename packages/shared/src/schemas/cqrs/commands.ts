/**
 * ---
 * layer: shared
 * kind: schema
 * domain: cqrs
 * tooling: zod
 * purpose: Команды write-side для geo sync (regions/places/all).
 * ---
 */
import { z } from "zod";

export const syncRegionsCommandSchema = z.object({
  target: z.literal("regions"),
  dryRun: z.boolean().default(false),
});

export const syncPlacesCommandSchema = z.object({
  target: z.literal("places"),
  dryRun: z.boolean().default(false),
});

export const syncAllCommandSchema = z.object({
  target: z.literal("all"),
  dryRun: z.boolean().default(false),
});

export type SyncRegionsCommand = z.infer<typeof syncRegionsCommandSchema>;
export type SyncPlacesCommand = z.infer<typeof syncPlacesCommandSchema>;
export type SyncAllCommand = z.infer<typeof syncAllCommandSchema>;
