import { z } from "zod";

const tileSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  /** Опционально: MD5 hex (иначе берётся с Geofabrik {url}.md5). */
  checksumMd5: z.string().regex(/^[a-f0-9]{32}$/i).optional(),
});

const odpMigrationSchema = z.object({
  targetProfileId: z.string().min(1),
  futureField: z.string().min(1),
  note: z.string().optional(),
});

/** SSOT конфигурации basemap / operational area (→ ODP geoBasemapPack). */
export const geoBasemapManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  odpMigration: odpMigrationSchema.optional(),
  sources: z.array(tileSourceSchema).min(1),
  merge: z.object({
    tool: z.literal("osmium"),
    inputs: z.array(z.string().min(1)).min(1),
    outputPath: z.string().min(1),
  }),
  /** tilemaker: без shapefile-слоёв + bbox operational area. */
  tilemaker: z
    .object({
      configPath: z.string().min(1).optional(),
      /** minLon, minLat, maxLon, maxLat */
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      /** Обзорка на всю зону (города, z≤11). */
      overview: z
        .object({
          configPath: z.string().min(1),
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        })
        .optional(),
      /** Детализация западной зоны (НП, z≤13). */
      detail: z
        .object({
          configPath: z.string().min(1),
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        })
        .optional(),
    })
    .optional(),
  labelLocales: z.object({
    priority: z.array(z.string().min(1)).min(1),
  }),
  themes: z.object({
    dark: z.object({
      mbtiles: z.string().min(1),
      mbtilesDetail: z.string().min(1).optional(),
      styleId: z.string().min(1),
    }),
    light: z.object({
      mbtiles: z.string().min(1),
      mbtilesDetail: z.string().min(1).optional(),
      styleId: z.string().min(1),
    }),
  }),
  tileserver: z.object({
    configPath: z.string().min(1),
    port: z.number().int().positive().optional(),
  }),
  /** Docker-образы пайплайна (override без правки скриптов). */
  docker: z
    .object({
      osmium: z.string().min(1).optional(),
      tilemaker: z.string().min(1).optional(),
    })
    .optional(),
});

export type GeoBasemapManifest = z.infer<typeof geoBasemapManifestSchema>;
