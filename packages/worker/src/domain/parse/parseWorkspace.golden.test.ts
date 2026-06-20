import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runParseWorkspaceOrchestrator } from "./ParseWorkspaceOrchestrator.js";
import { buildTestPlaceScanService } from "./geo/testPlaceScanFixture.js";
import { applyCandidateCollapsers } from "./candidateCollapsers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "../../../../shared/src/domain/parse/__fixtures__", name), "utf8");

const TAGANROG_FIXTURE = fixture("gf-p6-02-taganrog-multiline.txt").trim();
const MO_ONELINER = fixture("gf-p6-01-mo-oneline.txt").trim();
const GEO_CONFLICT = fixture("gf-p6-04-geo-conflict.txt").trim();

test("GF-P6-01: три MO one-liner → 3 place candidates", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "11111111-1111-1111-1111-111111111111",
    rawText: MO_ONELINER,
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  const districts = result.workspace.candidates.filter(
    (c) => c.anchor.kind === "place" && c.anchor.regionCode === "RU-NIZ",
  );
  assert.equal(districts.length, 3);
});

test("GF-P6-02: Таганрог + область + опасность → place candidate", () => {  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "33333333-3333-3333-3333-333333333333",
    rawText: TAGANROG_FIXTURE,
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;

  const places = result.workspace.candidates.filter((c) => c.anchor.kind === "place");
  assert.ok(places.some((c) => c.anchor.name.toLowerCase().includes("таганрог")));
  assert.ok(
    result.workspace.traitAttachments.some((t) => t.traitKey === "eventType" && t.value === "danger")
    || result.workspace.candidates.some((c) => c.eventType === "danger"),
  );
});

test("GF-P6-02: workspace path даёт materializable candidate", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "44444444-4444-4444-4444-444444444444",
    rawText: TAGANROG_FIXTURE,
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  const valid = result.workspace.candidates.filter(
    (c) => c.anchor.kind !== "system",
  );
  assert.ok(valid.length >= 1);
  assert.ok(
    result.workspace.traitAttachments.some((t) => t.traitKey === "eventType")
    || valid.some((c) => c.eventType !== "unknown"),
  );
});

test("GF-P6-03: Кулебакский мо → district place", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "55555555-5555-5555-5555-555555555555",
    rawText: "Кулебакский мо Внимание",
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  const mo = result.workspace.candidates.find(
    (c) => c.anchor.kind === "place" && c.anchor.name.includes("Кулебак"),
  );
  assert.ok(mo);
  assert.equal(mo!.anchor.regionCode, "RU-NIZ");
});

test("GF-P6-04: Таганрог + Саратовская → geoConflict", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "66666666-6666-6666-6666-666666666666",
    rawText: GEO_CONFLICT,
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  assert.equal(result.workspace.namespaces.geoConflict, true);
  assert.ok(result.workspace.candidates.some((c) => c.anchor.kind === "place"));
  assert.ok(result.workspace.candidates.some((c) => c.anchor.kind === "region"));
});

test("GF-P6-05: Киров → geoImprecise при коллизии", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "77777777-7777-7777-7777-777777777777",
    rawText: "Киров\nОпасность",
    placeScan,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;
  const kirov = result.workspace.candidates.filter(
    (c) => c.anchor.kind === "place" && c.anchor.name === "Киров",
  );
  assert.equal(kirov.length, 1);
  assert.equal(kirov[0]!.extras.geoImprecise, true);
});

test("GF-P6-06: one-liner = multiline parity (Таганрог)", () => {
  const placeScan = buildTestPlaceScanService();
  const multiline = runParseWorkspaceOrchestrator({
    rawMessageId: "88888888-8888-8888-8888-888888888881",
    rawText: TAGANROG_FIXTURE,
    placeScan,
  });
  const oneline = runParseWorkspaceOrchestrator({
    rawMessageId: "88888888-8888-8888-8888-888888888882",
    rawText: TAGANROG_FIXTURE.replace(/\n/g, " "),
    placeScan,
  });
  assert.equal(multiline.kind, "event");
  assert.equal(oneline.kind, "event");
  if (multiline.kind !== "event" || oneline.kind !== "event") return;
  const names = (ws: typeof multiline.workspace) =>
    ws.candidates
      .filter((c) => c.anchor.kind === "place")
      .map((c) => c.anchor.name)
      .sort();
  assert.deepEqual(names(oneline.workspace), names(multiline.workspace));
});

test("geoConflict: collapse не убирает region anchor", () => {
  const placeScan = buildTestPlaceScanService();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "99999999-9999-9999-9999-999999999999",
    rawText: GEO_CONFLICT,
    placeScan,
  });
  if (result.kind !== "event") return;
  const collapsed = applyCandidateCollapsers(result.workspace.candidates, result.workspace);
  assert.ok(collapsed.some((c) => c.anchor.kind === "region"));
  assert.ok(collapsed.some((c) => c.anchor.kind === "place"));
});