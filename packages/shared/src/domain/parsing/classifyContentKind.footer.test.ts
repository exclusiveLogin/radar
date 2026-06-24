import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentKind } from "./classifyContentKind.js";

const RUSSIA_FOOTER =
  " ❗️Радар по всей России - @radarrussiia 🌐 Обход белых списков - @Internet_Boost_bot";

test("classifyContentKind: оперативка Radar Russia с footer — event, не noise", () => {
  const samples = [
    `Тульская область Смоленская область Тревога по БПЛА${RUSSIA_FOOTER}`,
    `Курская область Белгородская область Опасность по БПЛА${RUSSIA_FOOTER}а`,
    `Алексин Тульская область Работа ПВО по БПЛА Меры безопасности${RUSSIA_FOOTER}`,
    `Ельнинский район Смоленская область Фиксация БПЛА${RUSSIA_FOOTER}`,
    `Таганрогский залив Таганрог Ракетная опасность Ростовская область${RUSSIA_FOOTER}а`,
  ];
  for (const text of samples) {
    assert.equal(classifyContentKind(text), "event", text.slice(0, 60));
  }
});

test("classifyContentKind: чистый promo footer без оперативки — noise", () => {
  assert.equal(
    classifyContentKind(`❗️Радар по всей России - @radarrussiia 🌐 Обход белых списков`),
    "noise",
  );
});
