import assert from "node:assert/strict";
import test from "node:test";
import { groomRawTextForDisplay } from "./groomRawTextForDisplay.js";

test("groomRawTextForDisplay: обрезает radar promo footer", () => {
  const raw =
    "Ивановка - пролёт БПЛА.\n\n❗️Радар по всей России - @radarrussiia\n🌐 Обход белых списков";
  assert.equal(
    groomRawTextForDisplay(raw),
    "Ивановка - пролёт БПЛА.",
  );
});

test("groomRawTextForDisplay: обрезает хвост «Меры безопасности»", () => {
  const raw =
    "Щекинский район\nТульская область\nРабота ПВО по БПЛА\nМеры безопасности\n\n❗️Радар";
  assert.equal(
    groomRawTextForDisplay(raw),
    "Щекинский район\nТульская область\nРабота ПВО по БПЛА",
  );
});
