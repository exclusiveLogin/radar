import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentKind } from "./classifyContentKind.js";
import { isChannelCityListPromo } from "./channelCityListPromo.js";
import { extractEventType } from "./extractEventType.js";

const CHANNEL_PROMO =
  "❗️ВНИМАНИЕ, ТРЕВОГА❗️\n"
  + "Ищите свой регион и подписывайтесь:\n"
  + "Москва 24/7\nПитер 24/7\nСевастополь 24/7\nСимферополь 24/7\n";

test("перечень каналов 24/7 — promo noise", () => {
  assert.equal(isChannelCityListPromo(CHANNEL_PROMO), true);
  assert.equal(classifyContentKind(CHANNEL_PROMO), "noise");
  assert.equal(extractEventType(CHANNEL_PROMO), null);
});

test("оперативная тревога без списка каналов — event", () => {
  const text = "Тревога! Возможна активность БПЛА над районом";
  assert.equal(isChannelCityListPromo(text), false);
  assert.equal(classifyContentKind(text), "event");
  assert.equal(extractEventType(text), "mass_warning");
});
