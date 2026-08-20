/**
 * Фикстуры resolveLlmNodeGrounding (без сети / без LLM).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { GeoNode } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { appendCandidate } from "../parseProcessorContract.js";
import { createEmptyParseWorkspace } from "../parseWorkspaceFactory.js";
import {
  namesStemMatch,
  resolveLlmNodeGrounding,
  stemsAgree,
} from "./resolveLlmNodeGrounding.js";

test("stemsAgree: Белгород / Белгорода", () => {
  assert.equal(stemsAgree("белгород", "белгорода"), true);
  assert.equal(stemsAgree("а", "б"), false);
});

test("namesStemMatch: склонённая форма", () => {
  assert.equal(namesStemMatch("Белгород", "Белгорода"), true);
  assert.equal(namesStemMatch("Москва", "Санкт-Петербург"), false);
});

test("matched-candidate: каталожный кандидат по stem, канон из каталога", () => {
  const rawId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const ws = createEmptyParseWorkspace(rawId, "угроза в районе Белгорода");
  appendCandidate({
    workspace: ws,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    trust: 80,
    eventType: "danger",
    provenance: { eventTypeSource: "test", anchorSource: "catalog" },
    anchor: {
      kind: "place",
      name: "Белгород",
      regionCode: "BEL",
      span: { start: 0, end: 8, matchedText: "Белгород" },
    },
  });

  const node: GeoNode = {
    name: "Белгорода",
    kind: "city",
    regionCode: "BEL",
    confidence: 0.9,
  };
  const outcome = resolveLlmNodeGrounding(node, ws);
  assert.equal(outcome.kind, "matched-candidate");
  if (outcome.kind === "matched-candidate") {
    assert.equal(outcome.canonicalName, "Белгород");
  }
});

test("llm-only: имя есть в raw, нет среди кандидатов", () => {
  const rawId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const text = "фиксация Буйнакск";
  const ws = createEmptyParseWorkspace(rawId, text);
  const node: GeoNode = { name: "Буйнакск", kind: "city", confidence: 0.7 };
  const outcome = resolveLlmNodeGrounding(node, ws);
  assert.equal(outcome.kind, "llm-only");
  if (outcome.kind === "llm-only") {
    assert.equal(outcome.canonicalName, "Буйнакск");
    assert.ok(outcome.span.matchedText.length > 0);
  }
});

test("ungrounded: нет ни в кандидатах, ни в raw", () => {
  const rawId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const ws = createEmptyParseWorkspace(rawId, "угроза без топонима");
  const node: GeoNode = { name: "Выдуманск", kind: "city", confidence: 0.95 };
  const outcome = resolveLlmNodeGrounding(node, ws);
  assert.equal(outcome.kind, "ungrounded");
  if (outcome.kind === "ungrounded") {
    assert.equal(outcome.canonicalName, "Выдуманск");
  }
});

test("matched-candidate by regionCode when both region", () => {
  const rawId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const ws = createEmptyParseWorkspace(rawId, "область под ударом");
  const name = "Белгородская область";
  const id = buildCandidateId({
    rawMessageId: rawId,
    spanStart: 0,
    spanEnd: name.length,
    anchorKind: "region",
    anchorName: name,
    authorProcessorId: "geo-processor",
  });
  ws.candidates.push({
    id,
    anchor: {
      kind: "region",
      name,
      regionCode: "BEL",
      span: { start: 0, end: name.length, matchedText: name },
    },
    eventType: "danger",
    extras: {},
    provenance: { eventTypeSource: "test", anchorSource: "catalog" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    status: "active",
    mergeKey: buildCandidateMergeKey({
      spanStart: 0,
      spanEnd: name.length,
      anchorKind: "region",
      anchorName: name,
      regionCode: "BEL",
    }),
    trust: 80,
  });

  const node: GeoNode = {
    name: "Белгородская",
    kind: "region",
    regionCode: "BEL",
  };
  const outcome = resolveLlmNodeGrounding(node, ws);
  assert.equal(outcome.kind, "matched-candidate");
});
