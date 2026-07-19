#!/usr/bin/env node
/**
 * Проверка runtime-ассетов в docker prod-контейнерах (файлы на диске + bind-mount с хоста).
 * SSOT путей — синхронизировать с docker/Dockerfile.{api,worker} и docker-compose*.yml.
 *
 *   node scripts/docker-runtime-assets-check.mjs
 *   node scripts/docker-runtime-assets-check.mjs --profile prod
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const profile = process.argv.includes("--profile")
  ? process.argv[process.argv.indexOf("--profile") + 1] ?? "prod"
  : "prod";

/** Пути относительно /app в контейнере или корня репо на хосте. */
const RUSSIA_REGIONS_GEOJSON = path.join(
  "data",
  "geo",
  "artifacts",
  "boundaries",
  "Russia_geojson_OSM",
  "GeoJson's",
  "Countries",
  "Russia_regions.geojson",
);

const IMAGE_ASSETS = {
  api: [
    "deployment.manifest.json",
    RUSSIA_REGIONS_GEOJSON,
    "data/geo/catalog/regions.json",
    "data/geo/dictionaries/adjacency.json",
    "data/geo/dictionaries/layout.json",
    "data/geo/artifacts/manifest.json",
  ],
  worker: [
    "deployment.manifest.json",
    "worker.runtime.manifest.json",
    "geo.enrichers.manifest.json",
    "packages/persistence/dist/index.js",
    "packages/transport-rmq/dist/index.js",
    "packages/worker/dist/index.js",
    RUSSIA_REGIONS_GEOJSON,
    "data/geo/catalog/regions.json",
    "data/parse/segmenter-rules.v1.yaml",
    "data/parse/parse-processors.v1.yaml",
    "data/parse/parse-enrichers.v1.yaml",
    "docs/examples/ingest.manifest.radar-channels-mtproxy.json",
    "docs/examples/phase.manifest.default.json",
  ],
};

/** Bind-mount / volume с хоста — не в image, но обязателен для prod. */
const HOST_BIND_ASSETS = {
  tiles: ["data/tiles/output/config.json"],
  sessions: [".radar/sessions"],
};

const SERVICE_BY_IMAGE = {
  api: "api",
  worker: "worker-ingest",
};

function posix(p) {
  return p.split(path.sep).join("/");
}

function composeBaseArgs() {
  const files = ["docker-compose.yml"];
  if (profile === "prod") files.push("docker-compose.prod.yml");
  else if (profile === "app") files.push("docker-compose.app.yml");
  return files.flatMap((f) => ["-f", f]);
}

function isContainerRunning(service) {
  const args = [
    "compose",
    ...composeBaseArgs(),
    "ps",
    "--status",
    "running",
    "-q",
    service,
  ];
  const res = spawnSync("docker", args, { cwd: repoRoot, encoding: "utf8" });
  return Boolean(res.stdout?.trim());
}

function checkInContainer(service, relPath) {
  const abs = `/app/${posix(relPath)}`;
  const script = `process.exit(require('fs').existsSync(${JSON.stringify(abs)})?0:1)`;
  const res = spawnSync(
    "docker",
    ["compose", ...composeBaseArgs(), "exec", "-T", service, "node", "-e", script],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return res.status === 0;
}

function checkOnHost(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function printSection(title) {
  console.log(`\n## ${title}`);
}

let failed = 0;

printSection(`Image assets (profile=${profile})`);

for (const [image, paths] of Object.entries(IMAGE_ASSETS)) {
  const service = SERVICE_BY_IMAGE[image];
  const running = isContainerRunning(service);
  console.log(`\n[${image}] service=${service} ${running ? "running" : "not running — skip container checks"}`);

  for (const rel of paths) {
    const label = posix(rel);
    if (running) {
      const ok = checkInContainer(service, rel);
      console.log(ok ? `  OK  ${label}` : `  FAIL ${label}`);
      if (!ok) failed += 1;
    } else {
      const ok = checkOnHost(rel);
      console.log(ok ? `  OK  ${label} (host)` : `  FAIL ${label} (host)`);
      if (!ok) failed += 1;
    }
  }
}

printSection("Host bind-mounts (compose volumes)");

for (const [name, paths] of Object.entries(HOST_BIND_ASSETS)) {
  console.log(`\n[${name}]`);
  for (const rel of paths) {
    const label = posix(rel);
    const ok = checkOnHost(rel);
    const hint =
      name === "tiles"
        ? " → npm run radar -- stack tiles:sync"
        : name === "sessions"
          ? " → npm run radar -- ingest session:deploy"
          : "";
    console.log(ok ? `  OK  ${label}` : `  WARN ${label} (optional until first use)${hint}`);
    // sessions/tiles — operational, не валим CI если пусто на свежем стенде
  }
}

printSection("Known prod gaps (informational)");
console.log(`
  • API parse-pipeline (reparse/reset из админки) spawn'ит npm -w @radar/worker — в api image worker нет.
    В prod используйте worker-phase / CLI на хосте.
  • .radar/ingest.manifest.json / phase.manifest.json — после import в БД не нужны в контейнере.
  • data/geo/vendor — не нужен в runtime (только для geo sync на хосте).
`);

if (failed > 0) {
  console.error(`\nFAILED: ${failed} missing runtime asset(s). Rebuild images: npm run docker:prod:build`);
  process.exit(1);
}

console.log("\nOK: все обязательные image-ассеты на месте.");
