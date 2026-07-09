/**
 * ---
 * layer: shared/schemas
 * domain: admin / runner-platform
 * purpose: merged read-side контракт discovery (runtime obs + workbook + stats).
 * ---
 */
import { z } from "zod";
import { runtimeObservabilitySnapshotSchema } from "../observability/runtime-observability-snapshot";
import { statsOverviewSchema } from "./stats";
import { workbookObservabilityResponseSchema } from "./workbook";

/** Admin Runner Discovery: obs runtime + workbook workloads + stats overview. */
export const runnerDiscoveryResponseSchema = z.object({
  runtime: runtimeObservabilitySnapshotSchema,
  workbook: workbookObservabilityResponseSchema,
  stats: statsOverviewSchema,
  generatedAt: z.string().datetime(),
});
export type RunnerDiscoveryResponse = z.infer<typeof runnerDiscoveryResponseSchema>;
