import assert from "node:assert/strict";
import test from "node:test";
import { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { planFinalize } from "./ParseFinalizerService.js";
import { runParseWorkspaceOrchestrator } from "./ParseWorkspaceOrchestrator.js";
import {
  extractMassClearExcludeSegment,
  isChannelWideMassClearText,
} from "./massClearScope.js";

const RVK_MASS_CLEAR =
  "Отбой беспилотной опасности по всем ранее объявленным регионам, в том числе и по Воронежской области";

const RVK_MASS_CLEAR_KROME =
  "Отбой по всем ранее объявленным регионам кроме Нижегородская область";

test("isChannelWideMassClearText: RVK массовый отбой", () => {
  assert.equal(isChannelWideMassClearText(RVK_MASS_CLEAR), true);
  assert.equal(
    isChannelWideMassClearText(
      "Отбой ракетной опасности по всем ранее объявленным регионам.",
    ),
    true,
  );
});

test("isChannelWideMassClearText: точечный отбой — false", () => {
  assert.equal(
    isChannelWideMassClearText("Саратовская область - отбой опасности по БПЛА"),
    false,
  );
});

test("extractMassClearExcludeSegment: хвост после «кроме»", () => {
  assert.equal(
    extractMassClearExcludeSegment(RVK_MASS_CLEAR_KROME),
    "Нижегородская область",
  );
});

test("mass-clear pipeline: channel-wide → один system cleared", () => {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    rawText: RVK_MASS_CLEAR,
    geoCatalog,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;

  assert.equal(result.workspace.candidates.length, 1);
  const only = result.workspace.candidates[0]!;
  assert.equal(only.authorProcessorId, "mass-clear-scope-processor");
  assert.equal(only.anchor.kind, "system");
  assert.equal(only.eventType, "cleared");
  assert.equal(only.extras.massClearChannel, true);

  const plan = planFinalize({
    workspace: result.workspace,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-19T14:00:00.000Z",
  });
  assert.equal(plan.materialized.length, 1);
});

test("mass-clear pipeline: кроме → excludedRegionCodes в extras", () => {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const result = runParseWorkspaceOrchestrator({
    rawMessageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    rawText: RVK_MASS_CLEAR_KROME,
    geoCatalog,
  });
  assert.equal(result.kind, "event");
  if (result.kind !== "event") return;

  const systemCandidate = result.workspace.candidates.find(
    (c) => c.extras.massClearChannel === true,
  );
  assert.ok(systemCandidate);
  const excluded = systemCandidate!.extras.excludedRegionCodes as string[] | undefined;
  assert.ok(Array.isArray(excluded));
  assert.ok(excluded!.includes("RU-NIZ"));
});
