import assert from "node:assert/strict";
import test from "node:test";
import { WipeTableLockError } from "../archive/wipeTableSql.js";
import { withSoftTruncateRetry } from "./softTruncateRetry.js";

test("soft retry повторяет deadlock и затем проходит", async () => {
  let calls = 0;
  const result = await withSoftTruncateRetry(
    false,
    async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("deadlock");
        (error as { code?: string }).code = "40P01";
        throw error;
      }
      return "ok";
    },
    { baseDelayMs: 0 },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("soft retry повторяет WipeTableLockError", async () => {
  let calls = 0;
  const result = await withSoftTruncateRetry(
    false,
    async () => {
      calls += 1;
      if (calls === 1) throw new WipeTableLockError(["mat_parse_event"]);
      return 1;
    },
    { baseDelayMs: 0 },
  );

  assert.equal(result, 1);
  assert.equal(calls, 2);
});

test("forceLocks не ретраит — сразу бросает", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withSoftTruncateRetry(true, async () => {
        calls += 1;
        throw new WipeTableLockError(["mat_parse_event"]);
      }),
    (error: unknown) => error instanceof WipeTableLockError,
  );
  assert.equal(calls, 1);
});
