#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./utils.mjs";

const artifactsRoot = join(repoRoot, "data", "geo", "artifacts");
const manifestPath = join(artifactsRoot, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("Нет data/geo/artifacts/manifest.json. Сначала: npm run geo:sync");
  process.exit(1);
}

/** @type {{ files?: Array<{ relPath?: string; artifactKey?: string; sha256?: string }> }} */
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = manifest.files ?? [];
if (files.length === 0) {
  console.log("manifest.files пуст — сверять нечего.");
  process.exit(0);
}

let checked = 0;
let mismatches = 0;
for (const file of files) {
  const rel = file.relPath ?? file.artifactKey;
  if (!rel || !file.sha256) continue;
  const abs = join(artifactsRoot, rel);
  if (!existsSync(abs)) {
    console.error(`[missing] ${rel}`);
    mismatches += 1;
    continue;
  }
  const hash = createHash("sha256").update(readFileSync(abs)).digest("hex");
  checked += 1;
  if (hash !== file.sha256) {
    console.error(`[mismatch] ${rel}`);
    mismatches += 1;
  }
}

console.log(`Проверено файлов: ${checked}. Ошибок: ${mismatches}.`);
if (mismatches > 0) process.exit(1);
