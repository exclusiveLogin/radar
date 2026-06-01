import type { GeoEnrichmentArtifact } from "@radar/shared";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveParsedEventActivation } from "./resolveParsedEventActivation.js";

test("без llm namespace — событие активно", () => {
  const artifact = { catalog: { schemaVersion: 1, regions: [], places: [] } } as GeoEnrichmentArtifact;
  assert.deepEqual(resolveParsedEventActivation(artifact), {
    isActive: true,
  });
});

test("llm eventCategory other — деактивация с reason", () => {
  assert.deepEqual(
    resolveParsedEventActivation({
      llm: {
        schemaVersion: 1,
        nodes: [],
        confidence: 0.9,
        reason: "реклама",
        eventCategory: "other",
      },
    }),
    { isActive: false, inactiveReason: "реклама" },
  );
});

test("llm threat — активно", () => {
  const artifact = {
    llm: {
      schemaVersion: 1,
      nodes: [],
      confidence: 0.8,
      reason: "угроза",
      eventCategory: "threat",
    },
  } as GeoEnrichmentArtifact;
  assert.deepEqual(resolveParsedEventActivation(artifact), { isActive: true });
});
