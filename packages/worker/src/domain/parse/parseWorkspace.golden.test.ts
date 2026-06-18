import assert from "node:assert/strict";
import test from "node:test";
import { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { runParseWorkspaceOrchestrator } from "./ParseWorkspaceOrchestrator.js";

const TAGANROG_FIXTURE = `Таганрог
Ростовская область
Опасность`;

test("GF-P1-01: Таганрог + область + опасность → place candidate", () => {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "33333333-3333-3333-3333-333333333333",
    rawText: TAGANROG_FIXTURE,
    geoCatalog,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;

  const places = result.workspace.candidates.filter((c) => c.anchor.kind === "place");
  assert.ok(places.some((c) => c.anchor.name.toLowerCase().includes("таганрог")));
  assert.ok(result.workspace.candidates.some((c) => c.eventType === "danger"));
});

test("GF-P1-04: workspace path даёт хотя бы один materializable candidate", () => {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "44444444-4444-4444-4444-444444444444",
    rawText: TAGANROG_FIXTURE,
    geoCatalog,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  const valid = result.workspace.candidates.filter(
    (c) => c.eventType !== "unknown" && c.anchor.kind !== "system",
  );
  assert.ok(valid.length >= 1);
});
