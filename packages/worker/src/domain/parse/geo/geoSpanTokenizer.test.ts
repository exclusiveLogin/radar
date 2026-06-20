import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeGeoSpans } from "./geoSpanTokenizer.js";

test("tokenizeGeoSpans: Кулебакский мо + Внимание → один MO span", () => {
  const text = "Кулебакский мо Внимание";
  const spans = tokenizeGeoSpans(text);
  assert.ok(spans.some((s) => s.matchedText.toLowerCase().includes("кулебакский")));
  assert.equal(spans[0]?.kindHint, "district");
});

test("tokenizeGeoSpans: г. prefix city", () => {
  const text = "г. Таганрог опасность";
  const spans = tokenizeGeoSpans(text);
  assert.ok(spans.some((s) => s.matchedText.includes("Таганрог")));
});
