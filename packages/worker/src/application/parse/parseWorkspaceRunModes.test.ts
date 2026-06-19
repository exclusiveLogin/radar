import assert from "node:assert/strict";
import test from "node:test";
import type { PhaseDefinitionRecord } from "@radar/shared";
import {
  phaseEnrichersToRun,
  resolvePhaseRunKind,
} from "./parseWorkspaceRunModes.js";

function phase(partial: Partial<PhaseDefinitionRecord> & Pick<PhaseDefinitionRecord, "enrichers" | "trigger">): PhaseDefinitionRecord {
  return {
    id: "test",
    name: "test",
    enabled: true,
    order: 1,
    trigger: partial.trigger,
    enrichers: partial.enrichers,
    ...partial,
  } as PhaseDefinitionRecord;
}

test("phaseEnrichersToRun: без catalog", () => {
  assert.deepEqual(phaseEnrichersToRun(["catalog", "llm"]), ["llm"]);
});

test("resolvePhaseRunKind: eager catalog → rebuild", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ trigger: "eager", enrichers: ["catalog"] })),
    "rebuild",
  );
});

test("resolvePhaseRunKind: scheduled llm → phase_enrich", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ trigger: "scheduled", enrichers: ["llm"] })),
    "phase_enrich",
  );
});

test("resolvePhaseRunKind: eager catalog+llm → rebuild", () => {
  assert.equal(
    resolvePhaseRunKind(phase({ trigger: "eager", enrichers: ["catalog", "llm"] })),
    "rebuild",
  );
});
