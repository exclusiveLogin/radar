import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import type { EventType } from "@radar/shared";
import { appendCandidate, writeNamespaceSlice } from "./parseProcessorContract.js";
import { createTraitAttachment } from "./attachRule.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";
import { resolveLlmNodeGrounding } from "./geo/resolveLlmNodeGrounding.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

/**
 * LLM enricher: namespaces.llm + eventType traits + grounding (matched / llm-only / ungrounded).
 * Geo-кандидаты не отклоняются на other/noise — деактивация через resolveParsedEventActivation.
 */
export function runLlmProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const llm = artifact?.llm;

  let matchedCandidates = 0;
  let llmOnlyCount = 0;
  let ungroundedCount = 0;
  // При schema-fail фаза падает до processor; здесь счётчик остаётся 0 (успешный проход).
  const schemaFailures = 0;

  if (llm?.nodes?.length) {
    for (const node of llm.nodes) {
      if (!node.name?.trim()) continue;
      const outcome = resolveLlmNodeGrounding(node, workspace);

      if (outcome.kind === "matched-candidate") {
        matchedCandidates += 1;
        const candidate = outcome.candidate;
        if (typeof node.confidence === "number") {
          candidate.extras.llmConfidence = node.confidence;
        }
        if (typeof node.reason === "string" && node.reason.trim()) {
          candidate.extras.llmReason = node.reason;
        }
        // Канон остаётся именем каталога; LLM только аннотирует.
        continue;
      }

      const extras: Record<string, unknown> = {};
      if (typeof node.confidence === "number") {
        extras.llmConfidence = node.confidence;
      }
      if (typeof node.reason === "string" && node.reason.trim()) {
        extras.llmReason = node.reason;
      }

      if (outcome.kind === "llm-only") {
        llmOnlyCount += 1;
        extras.llmOnly = true;
      } else {
        ungroundedCount += 1;
        extras.llmUngrounded = true;
      }

      const anchorKind = node.kind === "region" ? "region" : "place";
      appendCandidate({
        workspace,
        authorProcessorId: AUTHOR,
        authorEnricherId: ENRICHER,
        anchor: {
          kind: anchorKind,
          name: outcome.canonicalName,
          regionCode: node.regionCode,
          placeFias: node.fiasId,
          lat: node.lat,
          lon: node.lon,
          span: outcome.span,
        },
        eventType: "unknown",
        extras,
        provenance: {
          eventTypeSource: "pending",
          anchorSource: AUTHOR,
        },
      });
    }
  }

  writeNamespaceSlice(workspace, "llm", {
    invoked: Boolean(llm),
    eventCategory: llm?.eventCategory,
    eventSubject: llm?.eventSubject,
    matchedCandidates,
    llmOnlyCount,
    ungroundedCount,
    schemaFailures,
  });

  const mappedEventType = mapLlmCategoryToEventType(llm?.eventCategory);
  if (mappedEventType) {
    workspace.traitAttachments.push(
      createTraitAttachment({
        processorId: AUTHOR,
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: mappedEventType,
        attachRule: { scope: "all_candidates" },
      }),
    );
  }
}

function mapLlmCategoryToEventType(category: string | undefined): EventType | null {
  if (!category) return null;
  const map: Record<string, EventType | null> = {
    all_clear: "cleared",
    cleared: "cleared",
    threat: "danger",
    danger: "danger",
    impact: "impact",
    intercept: "intercept",
    fixation: "fixation",
    movement: "fixation",
    pvo_work: "pvo_work",
    warning: "warning",
    mass_warning: "warning",
    attention: "attention",
    rocket_threat: "rocket_threat",
    noise: null,
    other: null,
  };
  return map[category] ?? "attention";
}
