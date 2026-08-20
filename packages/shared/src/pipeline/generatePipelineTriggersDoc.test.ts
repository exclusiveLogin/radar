/**
 * Snapshot: generated markdown === docs/reference/pipeline-triggers.md
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MONOREPO_ROOT } from "@repo/root";
import { generatePipelineTriggersDoc } from "./generatePipelineTriggersDoc.js";
import { loadPipelineManifest } from "./pipelineManifest.loader.js";

const DOC_PATH = path.join(MONOREPO_ROOT, "docs", "reference", "pipeline-triggers.md");

test("generatePipelineTriggersDoc matches committed docs/reference/pipeline-triggers.md", () => {
  const manifest = loadPipelineManifest({ repoRoot: MONOREPO_ROOT });
  const generated = generatePipelineTriggersDoc(manifest);
  assert.ok(fs.existsSync(DOC_PATH), `missing ${DOC_PATH} — create from generator`);
  const committed = fs.readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
  const normalized = generated.replace(/\r\n/g, "\n");
  assert.equal(
    committed,
    normalized,
    "docs/reference/pipeline-triggers.md drift — regenerate from generatePipelineTriggersDoc",
  );
});
