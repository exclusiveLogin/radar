import assert from "node:assert/strict";
import test from "node:test";
import { segmentMessage } from "./segmentMessage.js";
import { groomMessage } from "../groomMessage.js";

const TUAPSE_ONELINER =
  "Туапсе Адлер Сочи И близлежащие Опасность по БПЛА Краснодарский край ❗️Радар @radarrussiia";

test("segmentMessage: Tuapse one-liner → geo + signal blocks", () => {
  const groomed = groomMessage(TUAPSE_ONELINER);
  assert.equal(groomed.kind, "event");
  if (groomed.kind !== "event") return;

  assert.ok(!groomed.groomedText.includes("@radar"));
  assert.ok(!groomed.groomedText.includes("❗️"));

  const kinds = groomed.blocks.map((b) => b.kind);
  assert.ok(kinds.includes("signal"), `expected signal, got ${kinds.join(",")}`);
  assert.ok(
    kinds.some((k) => k === "unknown" || k === "geo"),
    `expected geo/unknown block, got ${kinds.join(",")}`,
  );
});

test("segmentMessage: split before Опасность without word boundary", () => {
  const blocks = segmentMessage("Туапсе Адлер Опасность по БПЛА");
  assert.equal(blocks.length, 2);
  assert.match(blocks[0]!.text, /Туапсе/i);
  assert.match(blocks[1]!.text, /Опасность/i);
  assert.equal(blocks[1]!.kind, "signal");
});

test("segmentMessage: multiline Taganrog regression", () => {
  const text = `Таганрог
Ростовская область
Опасность по БПЛА`;
  const blocks = segmentMessage(text);
  const kinds = blocks.map((b) => b.kind);
  assert.ok(kinds.includes("signal"));
});
