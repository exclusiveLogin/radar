import type { ParseWorkspace } from "@radar/shared";

import {

  extractMassFlag,

  extractMultipleFixationFlag,

  extractNegativeMonitoringFlag,

  extractUncertainFlag,

} from "@radar/shared";

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



/** Uncertain trait — «возможно/вероятно» в groomedText; все geo-кандидаты. */

export function runUncertainProcessor(workspace: ParseWorkspace): void {

  if (!extractUncertainFlag(workspace.groomedText)) return;

  workspace.traitAttachments.push(

    createTraitAttachment({

      processorId: "uncertain-processor",

      traitKey: "uncertain",

      value: true,

      attachRule: { scope: "all_candidates" },

    }),

  );

}



/** Negative monitoring — «фиксаций нет», «не наблюдаем»; блокирует materialize в finalize. */

export function runNegativeMonitoringProcessor(workspace: ParseWorkspace): void {

  if (!extractNegativeMonitoringFlag(workspace.groomedText)) return;

  workspace.traitAttachments.push(

    createTraitAttachment({

      processorId: "negative-monitoring-processor",

      traitKey: "negativeMonitoring",

      value: true,

      attachRule: { scope: "all_candidates" },

    }),

  );

}



/** Multiple fixation trait — «множественная фиксация»; тип остаётся fixation по ключу. */

export function runMultipleFixationProcessor(workspace: ParseWorkspace): void {

  if (!extractMultipleFixationFlag(workspace.groomedText)) return;

  workspace.traitAttachments.push(

    createTraitAttachment({

      processorId: "multiple-processor",

      traitKey: "multiple",

      value: true,

      attachRule: { scope: "all_candidates" },

    }),

  );

}



/** Mass trait — массовость отдельно от типа; только place candidates. */

export function runMassProcessor(workspace: ParseWorkspace): void {

  if (!extractMassFlag(workspace.groomedText)) return;

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


