import assert from "node:assert/strict";
import test from "node:test";
import { phasePolicySchema } from "../schemas/enrichment/phase.js";
import { DEFAULT_PHASE_TERMINAL_POLICY } from "../schemas/enrichment/phaseTerminalPolicy.js";
import { resolveWorkQueueStatusAfterFailure } from "./workQueueTerminalPolicy.js";

test("phase schema and terminal resolver share retry defaults", () => {
  const policy = phasePolicySchema.parse({});

  assert.equal(policy.maxAttempts, DEFAULT_PHASE_TERMINAL_POLICY.maxAttempts);
  assert.equal(policy.retryFailed, DEFAULT_PHASE_TERMINAL_POLICY.retryFailed);
  assert.equal(
    resolveWorkQueueStatusAfterFailure({
      attempts: policy.maxAttempts - 2,
      ...policy,
    }),
    "pending",
  );
  assert.equal(
    resolveWorkQueueStatusAfterFailure({
      attempts: policy.maxAttempts - 1,
      ...policy,
    }),
    "failed",
  );
});
