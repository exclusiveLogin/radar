import { z } from "zod";
import { phaseRunSchema } from "./phase-run";

const coverageCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const geoJobCountsSchema = coverageCountsSchema;

export const phaseRunsOverviewSchema = z.object({
  runningCount: z.number().int().nonnegative(),
  ingest: z.object({
    runningCount: z.number().int().nonnegative(),
    byPhase: z.array(
      z.object({
        phaseId: z.string(),
        trigger: z.string(),
        enabled: z.boolean(),
        activeRun: phaseRunSchema.nullable(),
        coverage: coverageCountsSchema,
      }),
    ),
  }),
  geo: z.object({
    byPhase: z.array(
      z.object({
        phaseId: z.string(),
        trigger: z.string(),
        enabled: z.boolean(),
        provider: z.enum(["dadata", "llm", "nominatim"]).nullable(),
        activeRun: phaseRunSchema.nullable(),
        jobs: geoJobCountsSchema,
      }),
    ),
  }),
});

export type PhaseRunsOverview = z.infer<typeof phaseRunsOverviewSchema>;
