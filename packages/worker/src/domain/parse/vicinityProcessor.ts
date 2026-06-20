import type { ParseWorkspace } from "@radar/shared";
import { createTraitAttachment } from "./attachRule.js";

const AUTHOR = "vicinity-processor";

/** Маркеры vicinity (ADR-012 §3): без \\b — Cyrillic word boundary ненадёжен. */
const VICINITY_MARKER =
  /(?:около|в\s+районе|рядом\s+с|вблизи|близлежащ\w*|ближайш\w*|пригород\w*)/iu;

function findBlockForIndex(
  workspace: ParseWorkspace,
  index: number,
): ParseWorkspace["blocks"][number] | undefined {
  return workspace.blocks.find(
    (block) => block.span.start <= index && index < block.span.end,
  );
}

/** VicinityProcessor: trait vicinity по block overlap, без extras.vicinity. */
export function runVicinityProcessor(workspace: ParseWorkspace): void {
  const text = workspace.groomedText;
  const match = VICINITY_MARKER.exec(text);
  if (!match || match.index === undefined) return;

  const block = findBlockForIndex(workspace, match.index);
  if (!block) return;

  const already = workspace.traitAttachments.some(
    (t) => t.traitKey === "vicinity" && t.processorId === AUTHOR,
  );
  if (already) return;

  workspace.traitAttachments.push(
    createTraitAttachment({
      processorId: AUTHOR,
      traitKey: "vicinity",
      value: true,
      attachRule: { scope: "by_span_overlap", span: block.span },
      matchedText: match[0],
    }),
  );
}

export const VICINITY_PROCESSOR_ID = AUTHOR;
