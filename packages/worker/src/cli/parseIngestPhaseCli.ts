import type { IngestParsePhaseSelection } from "../application/parse/loadIngestParsePhases.js";
import { readStringFlag, type CliFlagMap } from "./workerCliArgs.js";

/**
 * Offline CLI: без `--phases` — enabled из DB / deployment.manifest;
 * с `--phases=id1,id2` — override (включая disabled).
 */
export function parseIngestPhaseCli(map: CliFlagMap): IngestParsePhaseSelection {
  const phasesRaw = readStringFlag(map, ["phases"]);
  if (!phasesRaw) return { kind: "manifest" };

  const phaseIds = phasesRaw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (phaseIds.length === 0) return { kind: "manifest" };

  return { kind: "phase-ids", phaseIds };
}

/** parse:snap:ollama — добавляет llm, если пользователь не указал --phases сам. */
export function applyForceLlmPhaseSelection(
  selection: IngestParsePhaseSelection,
): IngestParsePhaseSelection {
  if (selection.kind === "phase-ids") {
    if (selection.phaseIds.includes("llm")) return selection;
    return { kind: "phase-ids", phaseIds: [...selection.phaseIds, "llm"] };
  }
  return { kind: "phase-ids", phaseIds: ["catalog", "llm"] };
}