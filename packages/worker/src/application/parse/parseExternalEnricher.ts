import type { ParseWorkspace } from "@radar/shared";
import type { ParseEnricherId } from "../../domain/parse/parseEnricherRegistry.js";

/** Внешнее обогащение workspace перед запуском domain processor. */
export type ParseExternalEnricher = {
  enrich(enricherId: ParseEnricherId, workspace: ParseWorkspace): Promise<void>;
};
