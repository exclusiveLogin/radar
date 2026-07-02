/**
 * ---
 * layer: shared/domain
 * domain: workbook
 * purpose: Единственная фабрика для описания workbook — код-first (см. workbookContracts.ts).
 * ---
 */
import type { WorkbookDefinition, WorkbookInstance } from "./workbookContracts.js";

export function createWorkbook<TCursor, TSlice, TArtifact>(
  definition: WorkbookDefinition<TCursor, TSlice, TArtifact>,
): WorkbookInstance<TCursor, TSlice, TArtifact> {
  return {
    descriptor: { pipelineKey: definition.pipelineKey, phases: definition.phases },
    evaluate: definition.evaluate,
  };
}
