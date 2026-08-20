import assert from "node:assert/strict";
import test from "node:test";
import type { PhaseDefinitionRecord } from "@radar/shared";
import { DEFAULT_PHASE_POLICY } from "@radar/shared";
import {
  phaseEnrichersToRun,
  resolvePhaseRunKind,
} from "./parseWorkspaceRunModes.js";

function phase(
  partial: Partial<PhaseDefinitionRecord> &
    Pick<PhaseDefinitionRecord, "enrichers" | "triggerMode">,
): PhaseDefinitionRecord {
  return {
    id: "test",
    enabled: true,
    order: 1,
    scope: "ingestParse",
    policy: DEFAULT_PHASE_POLICY,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
}

test("phaseEnrichersToRun: без catalog", () => {
  assert.deepEqual(phaseEnrichersToRun(["catalog", "llm"]), ["llm"]);
});

test("resolvePhaseRunKind: event catalog → rebuild", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ triggerMode: "event", enrichers: ["catalog"] })),
    "rebuild",
  );
});

test("resolvePhaseRunKind: both llm → phase_enrich", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ triggerMode: "both", enrichers: ["llm"] })),
    "phase_enrich",
  );
});

test("resolvePhaseRunKind: event catalog+llm → rebuild", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ triggerMode: "event", enrichers: ["catalog", "llm"] })),
    "rebuild",
  );
});
