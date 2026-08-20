import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbook } from "@radar/shared";
import { createWorkload } from "./createWorkload.js";

function memoryCursorStore(initial: number) {
  let value = initial;
  return {
    read: async () => value,
    write: async (next: number) => {
      value = next;
    },
    reset: async () => {
      value = initial;
    },
  };
}

test("createWorkload binds workbook.evaluate into a running jobKernel and exposes descriptor", async () => {
  const workbook = createWorkbook<number, number, number>({
    pipelineKey: "test-workload",
    phases: [{ id: "only-phase", enabled: true }],
    evaluate: async (slice) => ({ artifact: slice * 2, nextCursor: slice + 1 }),
  });

  const cursorStore = memoryCursorStore(0);
  const materialized: number[] = [];
  const workload = createWorkload({
    workbook,
    schedule: { mode: "event" },
    io: {
      cursorStore,
      loadSlice: async (cursor) =>
        cursor < 1 ? { slice: cursor, isEmpty: false } : { slice: 0, isEmpty: true },
      materialize: async (artifact) => {
        materialized.push(artifact);
      },
    },
  });

  assert.deepEqual(workload.descriptor, {
    pipelineKey: "test-workload",
    phases: [{ id: "only-phase", enabled: true }],
  });

  await workload.runOnce();
  assert.deepEqual(materialized, [0]);
  assert.equal(await cursorStore.read(), 1);
  assert.equal(workload.getStatus().pipelineKey, "test-workload");
});
