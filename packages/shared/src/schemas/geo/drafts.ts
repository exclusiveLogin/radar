import { z } from "zod";

export const regionDraftSchema = z.object({
  fiasId: z.string().optional(),
  kladrId: z.string().optional(),
  iso: z.string().optional(),
  name: z.string().min(1),
  nameWithType: z.string().optional(),
  shortName: z.string().optional(),
  federalDistrict: z.string().optional(),
  frontRegion: z.boolean().default(false),
  borderRegion: z.boolean().default(false),
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
  geometryArtifactKey: z.string().optional(),
  sourceMeta: z.record(z.string(), z.unknown()).optional(),
});

export const placeDraftSchema = z.object({
  regionCode: z.string().min(1),
  parentExternalKey: z.string().optional(),
  kind: z.enum([
    "district",
    "city",
    "locality",
    "settlement",
    "urban_okrug",
    "mo_go",
  ]),
  name: z.string().min(1),
  nameWithType: z.string().optional(),
  fiasId: z.string().optional(),
  kladrId: z.string().optional(),
  oktmo: z.string().optional(),
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
  geometryArtifactKey: z.string().optional(),
  sourceMeta: z.record(z.string(), z.unknown()).optional(),
  aliases: z.array(z.string().min(1)).optional(),
});

export const aliasDraftSchema = z.object({
  targetKind: z.enum(["region", "place"]),
  targetExternalKey: z.string().min(1),
  alias: z.string().min(1),
  source: z.enum(["auto", "manual"]).default("auto"),
});

export type RegionDraft = z.infer<typeof regionDraftSchema>;
export type PlaceDraft = z.infer<typeof placeDraftSchema>;
export type AliasDraft = z.infer<typeof aliasDraftSchema>;
