#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceDirectory = new URL("../src/infrastructure/persistence/", import.meta.url);
const workerPersistenceSources = [
  "createWorkerDataSource.ts",
  "workerDbRepos.ts",
].map((file) => new URL(file, sourceDirectory));

const sources = await Promise.all(
  workerPersistenceSources.map(async (file) => ({
    file: fileURLToPath(file),
    content: await readFile(file, "utf8"),
  })),
);

const forbiddenReference = /(api\/dist|resolveApiDistModule)/;
const violation = sources.find(({ content }) => forbiddenReference.test(content));

if (violation) {
  throw new Error(`Worker persistence reads API build output: ${violation.file}`);
}

console.log("[persistence-boundary] worker uses @radar/persistence without api/dist");
