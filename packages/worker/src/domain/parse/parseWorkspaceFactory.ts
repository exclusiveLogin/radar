import type { ParseWorkspace } from "@radar/shared";

/** Пустой workspace v2 для noise-path и offline report. */
export function createEmptyParseWorkspace(
  rawMessageId: string,
  groomedText: string,
): ParseWorkspace {
  return {
    schemaVersion: 2,
    rawMessageId,
    groomedText,
    blocks: [],
    candidates: [],
    traitAttachments: [],
    namespaces: {},
    processorLog: [],
    enricherRunLog: [],
  };
}
