/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking/research
 * purpose: Read-only snapshot локальной БД и materialized артефакты A/B tracking.
 *
 * Пример:
 * npm run tracking:research -w @radar/worker -- --hours=24
 * npm run tracking:research -w @radar/worker -- --all
 * ---
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  trackingPipelineConfigSchema,
  type TrackingCandidate,
} from "@radar/shared";
import { loadTrackingCandidates } from "../application/tracking/loadTrackingCandidates.js";
import {
  runTrackingResearchVariant,
  type TrackingResearchArtifact,
  type TrackingResearchVariant,
} from "../application/tracking/research/trackingResearchHarness.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

const VARIANTS: readonly TrackingResearchVariant[] = [
  "baseline",
  "no-field-direction",
  "empty-environment",
];

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const { since, until } = resolveWindow(flags);
  const outRoot = resolveResearchRoot(flags);
  // Отдельный DataSource: composition root стартует runner-platform для tracking role,
  // что несовместимо с read-only исследованием.
  const ds = await createWorkerDataSource();

  try {
    const [state] = await ds.query<{ config: unknown }[]>(
      `SELECT config FROM state_track_pipeline WHERE id = 'default'`,
    );
    const config = trackingPipelineConfigSchema.parse(state?.config ?? {});
    const candidates = normalizeCandidates(await loadTrackingCandidates(ds, {
      since,
      until,
      excludeConsumed: false,
    }));
    const runId = readStringFlag(flags, ["run-id"]) ?? createRunId(until);
    const runRoot = join(outRoot, runId);

    await writeSnapshot(runRoot, candidates, {
      runId,
      since: since.toISOString(),
      until: until.toISOString(),
      config,
    });

    const artifacts = new Map<TrackingResearchVariant, TrackingResearchArtifact>();
    for (const variant of VARIANTS) {
      const artifact = runTrackingResearchVariant(candidates, config, variant);
      artifacts.set(variant, artifact);
      await writeVariantArtifacts(runRoot, artifact);
    }

    const repeatBaseline = runTrackingResearchVariant(candidates, config, "baseline");
    const baseline = artifacts.get("baseline")!;
    const comparison = buildComparison(baseline, artifacts, repeatBaseline);
    await writeJson(join(runRoot, "comparison.json"), comparison);
    await writeFile(join(runRoot, "report.md"), buildReport({
      runId,
      since: since.toISOString(),
      until: until.toISOString(),
      candidates: candidates.length,
      comparison,
    }));

    console.log(JSON.stringify({
      runRoot,
      candidates: candidates.length,
      baselineDeterministic: comparison.baselineRepeat.deterministic,
      variants: comparison.variants,
    }, null, 2));
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
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
    source: "loadTrackingCandidates(excludeConsumed=false)",
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
        preservation: artifact.preservation,
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
    .map(([variant, result]) => [
      `| ${variant} | ${result.tracks} | ${result.candidatesWithFrontDistance} | ${result.reverseLinks} / ${result.linksWithFrontDistance} | ${result.membershipChangedFromBaseline} | ${result.preservation.missingEventLocationIds.length} |`,
    ])
    .join("\n");
  const baseline = input.comparison.variants.baseline;
  const evidenceNote =
    baseline.linksWithFrontDistance === 0
      ? `\n> Недостаточно данных для вывода о противотреках: нет построенных links с front-distance. Увеличьте окно или выберите инцидент с маршрутными точками.\n`
      : "";

  return `# Tracking research report\n\n`
    + `- Run: \`${input.runId}\`\n`
    + `- Window: ${input.since} — ${input.until}\n`
    + `- Snapshot candidates: ${input.candidates}\n`
    + `- DB access: read-only snapshot through \`loadTrackingCandidates(excludeConsumed=false)\`\n`
    + `- Baseline repeat deterministic: **${input.comparison.baselineRepeat.deterministic}**\n\n`
    + `## Variant comparison\n\n`
    + `| Variant | Tracks | Candidates with front data | Reverse links / links with front data | Membership changed from baseline | Missing source IDs |\n`
    + `| --- | ---: | ---: | ---: | ---: | ---: |\n`
    + `${rows}\n`
    + evidenceNote
    + `\n`
    + `## Artifact semantics\n\n`
    + `- \`links.jsonl\` contains links accepted by Step3 at the moment of greedy joining.\n`
    + `- \`membership.json\` maps every source event location to a stable research track key.\n`
    + `- \`rejects.json\` contains Step3 aggregate rejection counters.\n`
    + `- This report contains measurements only. It makes no algorithm-tuning recommendation.\n`;
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
