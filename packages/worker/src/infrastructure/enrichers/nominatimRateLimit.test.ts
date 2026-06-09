import test from "node:test";
import assert from "node:assert/strict";
import {
  extendNominatimCooldown,
  resetExternalGeocoderSerialForTests,
  waitExternalGeocoderSlot,
  waitNominatimSlot,
} from "./nominatimRateLimit.js";

test("waitExternalGeocoderSlot выдерживает min interval между вызовами", async () => {
  resetExternalGeocoderSerialForTests();
  const minMs = 50;
  const t0 = Date.now();
  await waitExternalGeocoderSlot(minMs);
  await waitExternalGeocoderSlot(minMs);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= minMs - 5, `expected >= ${minMs - 5}ms, got ${elapsed}ms`);
});

test("extendNominatimCooldown блокирует следующий слот", async () => {
  resetExternalGeocoderSerialForTests();
  extendNominatimCooldown(80);
  const t0 = Date.now();
  await waitExternalGeocoderSlot(10);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 70, `expected cooldown >= 70ms, got ${elapsed}ms`);
});

test("dadata и nominatim делят одну очередь — слоты строго по порядку", async () => {
  resetExternalGeocoderSerialForTests();
  const order: string[] = [];
  await Promise.all([
    waitExternalGeocoderSlot(0).then(() => {
      order.push("dadata");
    }),
    waitNominatimSlot(0).then(() => {
      order.push("nominatim");
    }),
  ]);
  assert.deepEqual(order, ["dadata", "nominatim"]);
});
