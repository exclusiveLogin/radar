import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryStabilityStore,
  createStabilityEngine,
  pipelineStabilityScope,
} from "./stabilityEngine.js";

test("reportIdle without prior busy never claims", async () => {
  const engine = createStabilityEngine(createMemoryStabilityStore());
  const claimed = await engine.reportIdle(pipelineStabilityScope("parse"));
  assert.equal(claimed, false);
});

test("busy → idle claims once; second idle loses race", async () => {
  const engine = createStabilityEngine(createMemoryStabilityStore());
  const scope = pipelineStabilityScope("parse");
  await engine.reportBusy(scope);
  assert.equal(await engine.reportIdle(scope), true);
  assert.equal(await engine.reportIdle(scope), false);
});

test("N parallel idle claims: exactly one winner", async () => {
  const engine = createStabilityEngine(createMemoryStabilityStore());
  const scope = pipelineStabilityScope("parse");
  await engine.reportBusy(scope);

  const results = await Promise.all(
    Array.from({ length: 8 }, () => engine.reportIdle(scope)),
  );
  assert.equal(results.filter(Boolean).length, 1);
});

test("after re-busy, idle can claim again", async () => {
  const engine = createStabilityEngine(createMemoryStabilityStore());
  const scope = pipelineStabilityScope("geo-enrich");
  await engine.reportBusy(scope);
  assert.equal(await engine.reportIdle(scope), true);
  await engine.reportBusy(scope);
  assert.equal(await engine.reportIdle(scope), true);
});
