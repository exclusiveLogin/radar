import assert from "node:assert/strict";
import test from "node:test";
import { enrichmentMissError, isEnrichmentJobMiss } from "./placeEnrichmentStatus.js";

test("enrichmentMissError", () => {
  assert.equal(enrichmentMissError("dadata"), "dadata:miss");
});

test("isEnrichmentJobMiss", () => {
  assert.equal(isEnrichmentJobMiss("dadata:miss"), true);
  assert.equal(isEnrichmentJobMiss("nominatim:miss"), true);
  assert.equal(isEnrichmentJobMiss("dadata: no enrichment result"), true);
  assert.equal(isEnrichmentJobMiss("timeout"), false);
});
