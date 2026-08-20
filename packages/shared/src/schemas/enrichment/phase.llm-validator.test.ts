import assert from "node:assert/strict";
import test from "node:test";
import {
  enricherIdSchema,
  legacyTriggerToMode,
  phaseManifestEntrySchema,
  phaseWakesOnSchedule,
} from "./phase.js";

test("enricherIdSchema принимает llm-validator", () => {
  assert.equal(enricherIdSchema.parse("llm-validator"), "llm-validator");
});

test("legacyTriggerToMode: eager→event, scheduled→both, manual→manual", () => {
  assert.equal(legacyTriggerToMode("eager"), "event");
  assert.equal(legacyTriggerToMode("scheduled"), "both");
  assert.equal(legacyTriggerToMode("manual"), "manual");
});

test("phaseManifestEntrySchema: triggerMode SSOT, legacy trigger нормализуется и отбрасывается", () => {
  const fromMode = phaseManifestEntrySchema.parse({
    id: "llm-validator",
    triggerMode: "both",
    scope: "ingestParse",
    enrichers: ["llm-validator"],
    policy: { batchSize: 50, intervalMs: 60000 },
    enabled: false,
    order: 2,
  });
  assert.equal(fromMode.triggerMode, "both");
  assert.equal("trigger" in fromMode, false);

  const fromLegacy = phaseManifestEntrySchema.parse({
    id: "catalog",
    trigger: "eager",
    enrichers: ["catalog"],
  });
  assert.equal(fromLegacy.triggerMode, "event");
});

test("phaseWakesOnSchedule: timeout|both", () => {
  assert.equal(phaseWakesOnSchedule("timeout"), true);
  assert.equal(phaseWakesOnSchedule("both"), true);
  assert.equal(phaseWakesOnSchedule("event"), false);
  assert.equal(phaseWakesOnSchedule("manual"), false);
});
