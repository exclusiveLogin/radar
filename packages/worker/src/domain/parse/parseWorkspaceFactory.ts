import type { ParseWorkspace } from "@radar/shared";

/** Пустой workspace для noise-path и offline report. */
export function createEmptyParseWorkspace(
  rawMessageId: string,
  groomedText: string,
): ParseWorkspace {
  return {
    schemaVersion: 1,
    rawMessageId,
    groomedText,
    blocks: [],
    candidates: [],
    traitAttachments: [],
    namespaces: {},
    processorLog: [],
  };
}
