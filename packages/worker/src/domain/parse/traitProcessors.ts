import type { ParseWorkspace } from "@radar/shared";
import { extractRepeatFlag } from "../parsing/extractRepeatFlag.js";
import { extractCounts } from "../parsing/extractCounts.js";
import { applyTraitToCandidates, createTraitAttachment } from "./attachRule.js";

/** Repeat trait — all candidates по умолчанию. */
export function runRepeatProcessor(workspace: ParseWorkspace): void {
  if (!extractRepeatFlag(workspace.groomedText)) return;
  const attachment = createTraitAttachment({
    processorId: "repeat-processor",
    traitKey: "repeat",
    value: true,
    attachRule: { scope: "all_candidates" },
  });
  workspace.traitAttachments.push(attachment);
  applyTraitToCandidates({ workspace, attachment });
}

/** Mass trait — только place candidates. */
export function runMassProcessor(workspace: ParseWorkspace): void {
  if (!/много|массирован/i.test(workspace.groomedText)) return;
  const attachment = createTraitAttachment({
    processorId: "mass-processor",
    traitKey: "mass",
    value: true,
    attachRule: { scope: "by_kind", kind: "place" },
  });
  workspace.traitAttachments.push(attachment);
  applyTraitToCandidates({ workspace, attachment });
}

/** Count trait — first candidate. */
export function runCountProcessor(workspace: ParseWorkspace): void {
  const count = extractCounts(workspace.groomedText);
  if (!count) return;
  const attachment = createTraitAttachment({
    processorId: "count-processor",
    traitKey: "count",
    value: count,
    attachRule: { scope: "first" },
  });
  workspace.traitAttachments.push(attachment);
  applyTraitToCandidates({ workspace, attachment });
}
