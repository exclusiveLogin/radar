import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  isParseMaintenanceError,
  ParseMaintenanceGate,
  PARSE_MAINTENANCE_CODE,
} from "./parse-maintenance.gate.js";

test("runRead отклоняет новые чтения после pause", async () => {
  const gate = new ParseMaintenanceGate();
  gate.pause();

  await assert.rejects(
    () => gate.runRead(async () => "ok"),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
});

test("waitForDrain ждёт активный read и пропускает TRUNCATE-окно", async () => {
  const gate = new ParseMaintenanceGate();
  let releaseRead!: () => void;
  const started = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });

  const readPromise = gate.runRead(async () => {
    await started;
    return "done";
  });

  gate.pause();
  const drainPromise = gate.waitForDrain(2_000);

  let drained = false;
  void drainPromise.then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false);

  releaseRead();
  await drainPromise;
  assert.equal(await readPromise, "done");
  assert.equal(drained, true);

  await assert.rejects(
    () => gate.runRead(async () => "late"),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
});

test("resume снова открывает read-path", async () => {
  const gate = new ParseMaintenanceGate();
  gate.pause();
  gate.resume();
  assert.equal(await gate.runRead(async () => 42), 42);
});

test("isParseMaintenanceError узнаёт 503 gate", async () => {
  const gate = new ParseMaintenanceGate();
  gate.pause();
  try {
    await gate.runRead(async () => "x");
    assert.fail("expected throw");
  } catch (error) {
    assert.equal(isParseMaintenanceError(error), true);
    const body = (error as ServiceUnavailableException).getResponse() as {
      code: string;
    };
    assert.equal(body.code, PARSE_MAINTENANCE_CODE);
  }
  assert.equal(isParseMaintenanceError(new Error("other")), false);
});
