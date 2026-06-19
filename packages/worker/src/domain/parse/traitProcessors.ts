import type { ParseWorkspace } from "@radar/shared";
import { extractRepeatFlag } from "../parsing/extractRepeatFlag.js";
import { extractCounts } from "../parsing/extractCounts.js";
import { createTraitAttachment } from "./attachRule.js";

/** Repeat trait — all candidates по AttachRule; SSOT: traitAttachments. */
export function runRepeatProcessor(workspace: ParseWorkspace): void {
  if (!extractRepeatFlag(workspace.groomedText)) return;
  workspace.traitAttachments.push(
    createTraitAttachment({
      processorId: "repeat-processor",
      traitKey: "repeat",
      value: true,
      attachRule: { scope: "all_candidates" },
    }),
  );
}

/** Mass trait — только place candidates. */
export function runMassProcessor(workspace: ParseWorkspace): void {
  if (!/много|массирован/i.test(workspace.groomedText)) return;
  workspace.traitAttachments.push(
    createTraitAttachment({
      processorId: "mass-processor",
      traitKey: "mass",
      value: true,
      attachRule: { scope: "by_kind", kind: "place" },
    }),
  );
}

/** Count trait — first candidate. */
export function runCountProcessor(workspace: ParseWorkspace): void {
  const count = extractCounts(workspace.groomedText);
  if (!count) return;
  workspace.traitAttachments.push(
    createTraitAttachment({
      processorId: "count-processor",
      traitKey: "count",
      value: count,
      attachRule: { scope: "first" },
    }),
  );
}
