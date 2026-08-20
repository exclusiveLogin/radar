/**
 * Контрактный тест на реальный pipeline.manifest.json:
 * связность графа trigger↔emits и резолв resets.handler.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MONOREPO_ROOT } from "@repo/root";
import { listSystemTopicRoutingKeys } from "../transport/topicCatalog.js";
import { buildPipelineGraph, stabilizedEmitKeyForPipeline } from "./pipelineGraph.js";
import { loadPipelineManifest } from "./pipelineManifest.loader.js";

/** Известные внешние / системные префиксы (не обязаны быть в step.emits). */
const KNOWN_EXTERNAL_EXACT = new Set(["radar.geo.enrich.request"]);

const KNOWN_RESET_HANDLERS = new Set(["parse", "geo", "tracking", "ingest"]);

function isKnownExternal(key: string): boolean {
  if (KNOWN_EXTERNAL_EXACT.has(key)) return true;
  return (
    key.startsWith("radar.system.") ||
    key.startsWith("radar.step.") ||
    key.startsWith("radar.runner.")
  );
}

test("pipeline.manifest.json: load + schema parse succeeds", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });
  assert.equal(manifest.version, 1);
  assert.ok(manifest.steps.length > 0, "expected at least one step");
  assert.ok(manifest.phases.length > 0, "expected at least one phase");
});

test("pipeline.manifest.json: trigger.on keys are produced or known-external/system", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });
  const emitted = new Set(manifest.steps.flatMap((s) => s.emits));
  const system = new Set(listSystemTopicRoutingKeys());

  for (const step of manifest.steps) {
    for (const key of step.trigger.on) {
      const ok = emitted.has(key) || system.has(key) || isKnownExternal(key);
      assert.ok(
        ok,
        `orphan trigger.on "${key}" on step "${step.id}" — not in emits, system catalog, or known external`,
      );
    }
  }
});

test("pipeline.manifest.json: emits keys are consumed (empty emits = terminal OK)", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });

  for (const from of manifest.steps) {
    if (from.emits.length === 0) continue; // terminal (напр. tracking / geo)
    for (const key of from.emits) {
      const consumers = manifest.steps.filter(
        (to) => to.id !== from.id && to.trigger.on.includes(key),
      );
      assert.ok(
        consumers.length > 0,
        `orphan emit "${key}" from step "${from.id}" — no other step.trigger.on consumes it`,
      );
    }
  }
});

test("pipeline.manifest.json: resets.handler in known registry", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });

  for (const step of manifest.steps) {
    const handler = step.resets?.handler;
    if (!handler) continue;
    assert.ok(
      KNOWN_RESET_HANDLERS.has(handler),
      `step "${step.id}" resets.handler="${handler}" not in [${[...KNOWN_RESET_HANDLERS].join(", ")}]`,
    );
  }
});

test("pipeline.manifest.json: geo-enrich has no edge to tracking (parallel, no retrack)", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });
  const graph = buildPipelineGraph(manifest);
  assert.equal(
    graph.edges.some((e) => e.fromStepId === "geo-enrich" && e.toStepId === "tracking"),
    false,
  );
  assert.ok(
    graph.edges.some(
      (e) =>
        e.fromStepId === "parse" &&
        e.toStepId === "tracking" &&
        e.key === "radar.parse.stabilized",
    ),
  );
  assert.equal(stabilizedEmitKeyForPipeline(manifest, "parse"), "radar.parse.stabilized");
  assert.equal(stabilizedEmitKeyForPipeline(manifest, "geo-enrich"), null);
});
