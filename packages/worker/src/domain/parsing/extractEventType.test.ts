import assert from "node:assert/strict";
import test from "node:test";
import { extractEventType } from "./extractEventType.js";

const PVO_RADAR_RUSSIA =
  "С 07:00 до 14:00 силами противоздушной обороны было уничтожено 122 БПЛА "
  + "над территориями Белгородской, Брянской, Калужской, Курской";

test("extractEventType: сводка ПВО Radar Russia — pvo_report", () => {
  assert.equal(extractEventType(PVO_RADAR_RUSSIA), "pvo_report");
});

test("extractEventType: «уничтожено N БПЛА» с кириллическим окончанием", () => {
  assert.equal(
    extractEventType("За ночь было уничтожено 45 БПЛА над Ленинградской областью"),
    "pvo_report",
  );
});

test("extractEventType: МО + фиксация — fixation, не pvo_report", () => {
  const text = "МО Серебряные Пруды Московская область Фиксация БПЛА";
  assert.equal(extractEventType(text), "fixation");
});
