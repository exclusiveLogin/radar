import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentKind } from "./classifyContentKind.js";
import {
  isChannelCityListPromo,
  isGarbageIngestPlaceName,
  normalizePlaceLabelForGeocode,
  stripChannelStatusPrefix,
} from "./channelCityListPromo.js";
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

test("stripChannelStatusPrefix: эмодзи статуса канала", () => {
  assert.equal(stripChannelStatusPrefix("🟡Актарск"), "Актарск");
  assert.equal(stripChannelStatusPrefix("🔴 Котлубань"), "Котлубань");
});

test("isGarbageIngestPlaceName: служебные строки канала", () => {
  assert.equal(isGarbageIngestPlaceName("📲 Канал тревог в MAX"), true);
  assert.equal(
    isGarbageIngestPlaceName("⏰ Последнее обновление 11032026 210327 (МСК)"),
    true,
  );
  assert.equal(isGarbageIngestPlaceName("🟢Саратов и ближайшее"), true);
  assert.equal(isGarbageIngestPlaceName("🔴Саратов НПЗ"), true);
  assert.equal(isGarbageIngestPlaceName("🟡Актарск"), false);
  assert.equal(isGarbageIngestPlaceName("Повторно"), true);
  assert.equal(isGarbageIngestPlaceName("Ещё группа летит"), true);
  assert.equal(isGarbageIngestPlaceName("Чувашия"), true);
  assert.equal(isGarbageIngestPlaceName("Мариуполь Невский дрон в небе"), true);
  assert.equal(isGarbageIngestPlaceName("Все цели уничтожены"), true);
  assert.equal(isGarbageIngestPlaceName("И далее в направлении Азовского моря"), true);
  assert.equal(isGarbageIngestPlaceName("Просим сохранять спокойствие"), true);
  assert.equal(isGarbageIngestPlaceName("Воздушные цели были уничтожены"), true);
  assert.equal(isGarbageIngestPlaceName("Прошло уже больше десятка"), true);
  assert.equal(isGarbageIngestPlaceName("Летит очень много"), true);
  assert.equal(isGarbageIngestPlaceName("Очень низко"), true);
  assert.equal(isGarbageIngestPlaceName("Тингута и ближайшие"), true);
  assert.equal(isGarbageIngestPlaceName("ЖД Вокзал Мариуполь"), true);
  assert.equal(isGarbageIngestPlaceName("Балаклавский район"), false);
});

test("normalizePlaceLabelForGeocode: канальные подписи → топоним", () => {
  assert.equal(normalizePlaceLabelForGeocode("Адлер и близлежащие"), "Адлер");
  assert.equal(normalizePlaceLabelForGeocode("ГО Подольск и близлежащие"), "Подольск");
  assert.equal(normalizePlaceLabelForGeocode("🟡Нижний Новгород"), "Нижний Новгород");
});
