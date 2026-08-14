/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking/research
 * purpose: Read-only snapshot локальной БД и materialized артефакты A/B tracking.
 *
 * Пример:
 * npm run tracking:research -w @radar/worker -- --since=2026-08-05T00:00:00Z --until=2026-08-06T00:00:00Z
 * npm run tracking:research -w @radar/worker -- --from=.radar/research/tracking/<run>/input
 * npm run tracking:research -w @radar/worker -- --variants=./sweep.json
 * ---
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  trackingPipelineConfigSchema,
  type TrackingCandidate,
  type TrackingPipelineConfig,
} from "@radar/shared";
import { loadTrackingCandidates } from "../application/tracking/loadTrackingCandidates.js";
import {
  defaultTrackingResearchSpecs,
  resolveTrackingResearchSpec,
  runTrackingResearchVariant,
  type TrackingResearchArtifact,
  type TrackingResearchSpec,
  type TrackingResearchVariant,
} from "../application/tracking/research/trackingResearchHarness.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const outRoot = resolveResearchRoot(flags);
  const fromPath = readStringFlag(flags, ["from"]);
  const specs = await resolveSpecs(flags);

  let candidates: TrackingCandidate[];
  let config: TrackingPipelineConfig;
  let sinceIso: string;
  let untilIso: string;
  let source: string;

  if (fromPath) {
    const replay = await loadReplaySnapshot(resolve(fromPath));
    candidates = replay.candidates;
    config = replay.config;
    sinceIso = replay.since;
    untilIso = replay.until;
    source = `replay:${resolve(fromPath)}`;
  } else {
    const { since, until } = resolveWindow(flags);
    const ds = await createWorkerDataSource();
    try {
      const [state] = await ds.query<{ config: unknown }[]>(
        `SELECT config FROM state_track_pipeline WHERE id = 'default'`,
      );
      config = trackingPipelineConfigSchema.parse(state?.config ?? {});
      candidates = normalizeCandidates(await loadTrackingCandidates(ds, {
        since,
        until,
        excludeConsumed: false,
      }));
      sinceIso = since.toISOString();
      untilIso = until.toISOString();
      source = "loadTrackingCandidates(excludeConsumed=false)";
    } finally {
      if (ds.isInitialized) await ds.destroy();
    }
  }

  const runId = readStringFlag(flags, ["run-id"]) ?? createRunId(new Date(untilIso));
  const runRoot = join(outRoot, runId);

  await writeSnapshot(runRoot, candidates, {
    runId,
    since: sinceIso,
    until: untilIso,
    config,
    source,
  });

  const artifacts = new Map<TrackingResearchVariant, TrackingResearchArtifact>();
  for (const spec of specs) {
    const artifact = runTrackingResearchVariant(candidates, config, spec);
    artifacts.set(artifact.variant, artifact);
    await writeVariantArtifacts(runRoot, artifact);
  }

  const baselineSpec = specs.find(spec => resolveTrackingResearchSpec(spec).id === "baseline")
    ?? specs[0]!;
  const baselineId = resolveTrackingResearchSpec(baselineSpec).id;
  const baseline = artifacts.get(baselineId)!;
  const repeatBaseline = runTrackingResearchVariant(candidates, config, baselineSpec);
  const comparison = buildComparison(baseline, artifacts, repeatBaseline);
  await writeJson(join(runRoot, "comparison.json"), comparison);
  await writeFile(join(runRoot, "report.md"), buildReport({
    runId,
    since: sinceIso,
    until: untilIso,
    candidates: candidates.length,
    comparison,
  }));

  console.log(JSON.stringify({
    runRoot,
    candidates: candidates.length,
    baselineDeterministic: comparison.baselineRepeat.deterministic,
    variants: comparison.variants,
  }, null, 2));
}

function resolveWindow(flags: ReturnType<typeof parseLongFlagsMap>): {
  since: Date;
  until: Date;
} {
  const until = parseDate(readStringFlag(flags, ["until"])) ?? new Date();
  const all = flags.has("all");
  if (all && (flags.has("since") || flags.has("hours"))) {
    throw new Error("--all нельзя сочетать с --since или --hours.");
  }
  const hours = Number(readStringFlag(flags, ["hours"]) ?? "24");
  const since = all
    ? new Date(0)
    : parseDate(readStringFlag(flags, ["since"]))
    ?? new Date(until.getTime() - hours * 3_600_000);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
    throw new Error("Нужно --all или корректное окно: --since < --until / положительный --hours.");
  }
  return { since, until };
}

function resolveResearchRoot(flags: ReturnType<typeof parseLongFlagsMap>): string {
  const configured = readStringFlag(flags, ["out"]);
  return configured
    ? resolve(configured)
    : join(MONOREPO_ROOT, ".radar", "research", "tracking");
}

/** --variants=path.json | inline JSON array of TrackingResearchSpec. */
async function resolveSpecs(
  flags: ReturnType<typeof parseLongFlagsMap>,
): Promise<TrackingResearchSpec[]> {
  const raw = readStringFlag(flags, ["variants"]);
  if (!raw) return defaultTrackingResearchSpecs();
  const text = raw.trim().startsWith("[") || raw.trim().startsWith("{")
    ? raw
    : await readFile(
      resolve(raw.startsWith(".") ? join(MONOREPO_ROOT, raw) : resolve(raw)),
      "utf8",
    );
  const parsed = JSON.parse(text) as TrackingResearchSpec | TrackingResearchSpec[];
  const specs = Array.isArray(parsed) ? parsed : [parsed];
  if (specs.length === 0) throw new Error("--variants пуст.");
  return specs;
}

async function loadReplaySnapshot(path: string): Promise<{
  candidates: TrackingCandidate[];
  config: TrackingPipelineConfig;
  since: string;
  until: string;
}> {
  const inputRoot = path.endsWith("candidates.jsonl") ? dirname(path) : path;
  const [lines, manifestRaw] = await Promise.all([
    readFile(join(inputRoot, "candidates.jsonl"), "utf8"),
    readFile(join(inputRoot, "manifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw) as {
    since?: string;
    until?: string;
    config?: unknown;
  };
  const candidates = normalizeCandidates(
    lines
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as TrackingCandidate),
  );
  return {
    candidates,
    config: trackingPipelineConfigSchema.parse(manifest.config ?? {}),
    since: manifest.since ?? candidates[0]?.occurredAt.toISOString() ?? new Date(0).toISOString(),
    until: manifest.until
      ?? candidates[candidates.length - 1]?.occurredAt.toISOString()
      ?? new Date().toISOString(),
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createRunId(until: Date): string {
  return `${until.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

async function writeSnapshot(
  runRoot: string,
  candidates: TrackingCandidate[],
  context: {
    runId: string;
    since: string;
    until: string;
    config: unknown;
    source: string;
  },
): Promise<void> {
  const inputRoot = join(runRoot, "input");
  await mkdir(inputRoot, { recursive: true });
  const serializedCandidates = candidates.map(serializeCandidate);
  const candidateLines = serializedCandidates.map(value => JSON.stringify(value)).join("\n");
  await writeFile(join(inputRoot, "candidates.jsonl"), `${candidateLines}\n`);
  await writeJson(join(inputRoot, "manifest.json"), {
    ...context,
    candidateCount: candidates.length,
    eventLocationIdsHash: hash(candidates.map(candidate => candidate.eventLocationId).join("\n")),
    configHash: hash(JSON.stringify(context.config)),
    readOnly: true,
  });
}

async function writeVariantArtifacts(
  runRoot: string,
  artifact: TrackingResearchArtifact,
): Promise<void> {
  const variantRoot = join(runRoot, "variants", artifact.variant);
  await mkdir(variantRoot, { recursive: true });
  await writeJsonl(join(variantRoot, "tracks.jsonl"), artifact.tracks);
  await writeJsonl(join(variantRoot, "links.jsonl"), artifact.links);
  await writeJson(join(variantRoot, "membership.json"), artifact.membership);
  await writeJson(join(variantRoot, "stats.json"), artifact.stats);
  await writeJson(join(variantRoot, "quality.json"), artifact.quality);
  await writeJson(join(variantRoot, "rejects.json"), artifact.stats.step3Rejects);
  await writeJson(join(variantRoot, "preservation.json"), artifact.preservation);
}

function buildComparison(
  baseline: TrackingResearchArtifact,
  artifacts: Map<TrackingResearchVariant, TrackingResearchArtifact>,
  repeatBaseline: TrackingResearchArtifact,
) {
  const variants = Object.fromEntries(
    [...artifacts.entries()].map(([variant, artifact]) => [
      variant,
      {
        tracks: artifact.stats.tracks,
        candidatesWithFrontDistance: artifact.stats.candidatesWithFrontDistance,
        reverseLinks: artifact.stats.reverseLinks,
        linksWithFrontDistance: artifact.stats.linksWithFrontDistance,
        membershipChangedFromBaseline: membershipDiff(
          baseline.membership,
          artifact.membership,
        ),
        quality: artifact.quality,
        preservation: {
          missing: artifact.preservation.missingEventLocationIds.length,
          duplicated: artifact.preservation.duplicatedEventLocationIds.length,
        },
      },
    ]),
  );

  return {
    baselineRepeat: {
      deterministic: sameMembership(baseline.membership, repeatBaseline.membership),
      membershipChanged: membershipDiff(baseline.membership, repeatBaseline.membership),
    },
    variants,
  };
}

function buildReport(input: {
  runId: string;
  since: string;
  until: string;
  candidates: number;
  comparison: ReturnType<typeof buildComparison>;
}): string {
  const rows = Object.entries(input.comparison.variants)
    .map(([variant, result]) => {
      const q = result.quality;
      return `| ${variant} | ${result.tracks} | ${(q.shareInTracksGe3 * 100).toFixed(1)}% | ${q.avgNodesPerTrack.toFixed(2)} | ${(q.singleNodeTrackShare * 100).toFixed(1)}% | ${(q.feasibleRecall * 100).toFixed(1)}% | ${q.zeroDistanceLinks}/${q.linksTotal} |`;
    })
    .join("\n");

  return `# Tracking research report\n\n`
    + `- Run: \`${input.runId}\`\n`
    + `- Window: ${input.since} — ${input.until}\n`
    + `- Snapshot candidates: ${input.candidates}\n`
    + `- Baseline repeat deterministic: **${input.comparison.baselineRepeat.deterministic}**\n\n`
    + `## Quality comparison\n\n`
    + `| Variant | Tracks | Share in ≥3 | Avg nodes | Single-node % | Feasible recall | Zero-dist links |\n`
    + `| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n`
    + `${rows}\n`
    + `\n`
    + `## Artifact semantics\n\n`
    + `- \`quality.json\` — fragmentation / физичность линков / recall допустимых пар.\n`
    + `- \`links.jsonl\` — links accepted by Step3 at greedy join time.\n`
    + `- This report contains measurements only.\n`;
}

function membershipDiff(
  baseline: Record<string, string>,
  compared: Record<string, string>,
): number {
  const ids = new Set([...Object.keys(baseline), ...Object.keys(compared)]);
  return [...ids].filter(id => baseline[id] !== compared[id]).length;
}

function sameMembership(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  return membershipDiff(left, right) === 0;
}

function serializeCandidate(candidate: TrackingCandidate) {
  return {
    ...candidate,
    occurredAt: candidate.occurredAt.toISOString(),
  };
}

/** pg numeric может прийти строкой; domain H3 требует именно finite number. */
function normalizeCandidates(candidates: TrackingCandidate[]): TrackingCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    lat: Number(candidate.lat),
    lon: Number(candidate.lon),
    trust: Number(candidate.trust),
    frontDistanceKm:
      candidate.frontDistanceKm == null ? null : Number(candidate.frontDistanceKm),
    nearestFrontLat:
      candidate.nearestFrontLat == null ? null : Number(candidate.nearestFrontLat),
    nearestFrontLon:
      candidate.nearestFrontLon == null ? null : Number(candidate.nearestFrontLon),
    occurredAt:
      candidate.occurredAt instanceof Date
        ? candidate.occurredAt
        : new Date(candidate.occurredAt),
  }));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path: string, values: readonly unknown[]): Promise<void> {
  await writeFile(path, `${values.map(value => JSON.stringify(value)).join("\n")}\n`);
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
