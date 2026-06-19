import type { ParseEnricherId } from "./parseEnricherRegistry.js";
import { listEnricherProcessorIds } from "./parseEnricherRegistry.js";
import type { EnricherRunContext } from "./parseEnricherRunner.js";
import {
  type ParseProcessorId,
  runProcessorById,
} from "./processorRegistry.js";

/** Запуск processors enricher-а по registry. */
export function runEnricherProcessors(
  enricherId: ParseEnricherId,
  ctx: EnricherRunContext,
): string[] {
  const ids = listEnricherProcessorIds(enricherId);
  const ran: string[] = [];
  for (const id of ids) {
    if (runProcessorById(id as ParseProcessorId, ctx)) {
      ran.push(id);
    }
  }
  return ran;
}
