/**
 * Wave 7: контракт LLM без сети — фикстурный ILlmChatClient.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  GeoEnrichmentArtifact,
  ILlmChatClient,
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
  ParseWorkspace,
} from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";
import type { LlmRuntimeConfig } from "../../../infrastructure/enrichers/llmRuntimeConfig.js";
import { createEmptyParseWorkspace } from "../parseWorkspaceFactory.js";
import { runLlmProcessor } from "../llmProcessor.js";
import {
  namesStemMatch,
  resolveLlmNodeGrounding,
} from "./resolveLlmNodeGrounding.js";
import { computeGeoCandidateScore, type GeoScoreMatrix } from "./geoCandidateScore.js";
import { isCandidateGeoScoreAcceptable } from "../geoPolicy.js";

const CONFIG: LlmRuntimeConfig = {
  enabled: true,
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "fixture",
  timeoutMs: 5_000,
  maxTokens: 220,
  temperature: 0,
  jsonMode: true,
  retryCount: 0,
  headers: {},
};

const MATRIX: GeoScoreMatrix = {
  revision: "test",
  base: 1.0,
  majorityClusterMin: 3,
  materializeGate: { enabled: true, threshold: 0.25 },
  factors: {
    uniqueStem: 0.15,
    imprecise: -0.2,
    adjectiveStem: -0.45,
    minorityRegion: -0.5,
    geoConflict: -0.35,
    channelPromo: -0.7,
    llmConfidence: 0.25,
    llmValidatorConfidence: 0.3,
    llmOnly: -0.35,
    llmUngrounded: -1.05,
  },
  llmValidator: { trigger: "auto", borderlineMargin: 0.15 },
};

function fixtureClient(content: string): ILlmChatClient {
  return {
    async chat(_messages: LlmChatMessage[], _opts: LlmChatOptions): Promise<LlmChatResult> {
      return { content, model: "fixture", latencyMs: 1 };
    },
    async preflight(): Promise<void> {},
  };
}

function placeCandidate(input: {
  rawMessageId: string;
  name: string;
  regionCode: string;
  start: number;
}) {
  const end = input.start + input.name.length;
  return {
    id: buildCandidateId({
      rawMessageId: input.rawMessageId,
      spanStart: input.start,
      spanEnd: end,
      anchorKind: "place" as const,
      anchorName: input.name,
      authorProcessorId: "geo-processor",
    }),
    anchor: {
      kind: "place" as const,
      name: input.name,
      regionCode: input.regionCode,
      span: { start: input.start, end, matchedText: input.name },
    },
    eventType: "danger",
    extras: {} as Record<string, unknown>,
    provenance: { eventTypeSource: "test", anchorSource: "geo-processor" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog" as const,
    status: "active" as const,
    mergeKey: buildCandidateMergeKey({
      spanStart: input.start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: input.name,
      regionCode: input.regionCode,
    }),
    trust: 80,
  };
}

test("stemsAgree: Белгорода ↔ Белгород", () => {
  assert.equal(namesStemMatch("Белгорода", "Белгород"), true);
  assert.equal(namesStemMatch("в Белгороде", "Белгород"), false);
});

test("resolveLlmNodeGrounding: склонённая форма → matched-candidate, канон каталога", () => {
  const rawMessageId = "44444444-4444-4444-4444-444444444444";
  const catalog = placeCandidate({
    rawMessageId,
    name: "Белгород",
    regionCode: "RU-BEL",
    start: 2,
  });
  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "в Белгороде тревога"),
    candidates: [catalog],
  };

  const outcome = resolveLlmNodeGrounding(
    { name: "Белгорода", kind: "city", regionCode: "RU-BEL", confidence: 0.9 },
    ws,
  );
  assert.equal(outcome.kind, "matched-candidate");
  if (outcome.kind !== "matched-candidate") return;
  assert.equal(outcome.canonicalName, "Белгород");
  assert.equal(outcome.candidate.id, catalog.id);
});

test("resolveLlmNodeGrounding: место в raw, нет в каталоге → llm-only", () => {
  const rawMessageId = "55555555-5555-5555-5555-555555555555";
  const ws = createEmptyParseWorkspace(rawMessageId, "Фиксация над Шебекино");
  const outcome = resolveLlmNodeGrounding(
    { name: "Шебекино", kind: "city", regionCode: "RU-BEL", confidence: 0.8 },
    ws,
  );
  assert.equal(outcome.kind, "llm-only");
});

test("resolveLlmNodeGrounding: выдуманное место → ungrounded", () => {
  const rawMessageId = "66666666-6666-6666-6666-666666666666";
  const ws = createEmptyParseWorkspace(rawMessageId, "Тревога по области без топонима");
  const outcome = resolveLlmNodeGrounding(
    { name: "Выдумкино", kind: "city", regionCode: "RU-BEL", confidence: 0.95 },
    ws,
  );
  assert.equal(outcome.kind, "ungrounded");
});

test("runLlmProcessor: matched не плодит дубль; llm-only / ungrounded ставят extras", () => {
  const rawMessageId = "77777777-7777-7777-7777-777777777777";
  const catalog = placeCandidate({
    rawMessageId,
    name: "Белгород",
    regionCode: "RU-BEL",
    start: 0,
  });
  const artifact: GeoEnrichmentArtifact = {
    llm: {
      schemaVersion: 1,
      confidence: 0.9,
      reason: "ok",
      eventCategory: "cleared",
      nodes: [
        { name: "Белгорода", kind: "city", regionCode: "RU-BEL", confidence: 0.91, reason: "lemma" },
        { name: "Шебекино", kind: "city", regionCode: "RU-BEL", confidence: 0.8 },
        { name: "Выдумкино", kind: "city", regionCode: "RU-BEL", confidence: 0.99 },
      ],
    },
  };
  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "Белгород и Шебекино"),
    candidates: [catalog],
    namespaces: { geoArtifact: artifact },
  };

  runLlmProcessor(ws);

  assert.equal(catalog.extras.llmConfidence, 0.91);
  assert.equal(catalog.extras.llmReason, "lemma");
  const belgorodDupes = ws.candidates.filter((c) => namesStemMatch(c.anchor.name ?? "", "Белгород"));
  assert.equal(belgorodDupes.length, 1);

  const llmOnly = ws.candidates.find((c) => c.extras.llmOnly === true);
  assert.ok(llmOnly);
  assert.equal(llmOnly!.anchor.name, "Шебекино");

  const ungrounded = ws.candidates.find((c) => c.extras.llmUngrounded === true);
  assert.ok(ungrounded);
  assert.equal(ungrounded!.anchor.name, "Выдумкино");

  const slice = ws.namespaces.llm as {
    matchedCandidates: number;
    llmOnlyCount: number;
    ungroundedCount: number;
  };
  assert.equal(slice.matchedCandidates, 1);
  assert.equal(slice.llmOnlyCount, 1);
  assert.equal(slice.ungroundedCount, 1);

  // eventCategory cleared → trait
  assert.ok(
    ws.traitAttachments.some((t) => t.traitKey === "eventType" && t.value === "cleared"),
  );
});

test("ungrounded + max llmConfidence не материализуется при дефолтной матрице", () => {
  const scored = computeGeoCandidateScore(
    { llmUngrounded: true, llmConfidence: 1, uniqueStem: false, geoImprecise: false, matchedViaAdjectiveStem: false, minorityRegion: false, geoConflict: false, channelPromo: false },
    MATRIX,
  );
  assert.ok(scored.score < MATRIX.materializeGate.threshold);
  assert.equal(
    isCandidateGeoScoreAcceptable({
      extras: { geoScore: scored.score },
      gateEnabled: true,
      threshold: MATRIX.materializeGate.threshold,
    }),
    false,
  );
});

test("LlmEnricher: schema-invalid kind → whole response fails (schema)", async () => {
  const enricher = new LlmEnricher(
    CONFIG,
    fixtureClient(
      JSON.stringify({
        places: [{ placeName: "Белгород", kind: "village", regionCode: "RU-BEL", confidence: 0.9 }],
        confidence: 0.9,
        reason: "bad kind",
      }),
    ),
  );
  const result = await enricher.enrich({ rawText: "Белгород" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "schema");
});

test("LlmEnricher: eventCategory cleared проходит SSOT схему", async () => {
  const enricher = new LlmEnricher(
    CONFIG,
    fixtureClient(
      JSON.stringify({
        places: [{ placeName: "Белгород", kind: "city", regionCode: "RU-BEL", confidence: 0.9 }],
        regionCode: "RU-BEL",
        confidence: 0.9,
        reason: "отбой",
        eventCategory: "cleared",
        eventSubject: null,
      }),
    ),
  );
  const result = await enricher.enrich({ rawText: "Отбой по Белгороду" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.eventCategory, "cleared");
});

test("LlmEnricher: eventCategory вне словаря → schema fail (не silent null)", async () => {
  const enricher = new LlmEnricher(
    CONFIG,
    fixtureClient(
      JSON.stringify({
        places: [{ placeName: "Белгород", kind: "city", regionCode: "RU-BEL", confidence: 0.9 }],
        confidence: 0.9,
        reason: "x",
        eventCategory: "totally_unknown_category",
      }),
    ),
  );
  const result = await enricher.enrich({ rawText: "Белгород" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "schema");
});
