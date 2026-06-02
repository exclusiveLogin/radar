import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

type SnapshotRow = {
  rawId: string;
  postedAt: string;
  parsedEventId: string | null;
  parsedEventType: string | null;
  parsedIsActive: boolean | null;
  eventCategory: string | null;
  locations: Array<{ regionIso: string | null }>;
};

type StateLevel = "grey" | "green" | "yellow" | "orange" | "red";

type RegionEvent = {
  postedAt: string;
  level: StateLevel;
  eventType: string | null;
  rawId: string;
  parsedEventId: string | null;
  cause: "rule" | "inactive";
};

const rank: Record<StateLevel, number> = {
  grey: 0,
  green: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};

function computeSelfLevel(current: StateLevel, incoming: StateLevel): StateLevel {
  if (incoming === "green") return "green";
  return rank[incoming] >= rank[current] ? incoming : current;
}

function computeEffectiveLevel(self: StateLevel, neighborSelf: StateLevel[]): StateLevel {
  if (self !== "grey") return self;
  return neighborSelf.includes("red") ? "yellow" : "grey";
}

async function main(): Promise<void> {
  const root = process.cwd();
  const snapshotPath = path.join(root, "reports", "raws_state_snapshot_100_20260602.jsonl");
  const adjacencyPath = path.join(root, "data", "geo", "dictionaries", "adjacency.json");

  const rows = fs
    .readFileSync(snapshotPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SnapshotRow);

  const adjacencyDoc = JSON.parse(fs.readFileSync(adjacencyPath, "utf8")) as {
    adjacency?: Record<string, string[]>;
  };
  const adjacency = adjacencyDoc.adjacency ?? {};

  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "radar",
    password: "radar",
    database: "radar",
  });
  await client.connect();

  const dictRows = await client.query<{
    code: string;
    state_level: StateLevel;
  }>("SELECT code, state_level FROM status_dictionary WHERE is_active=true");
  const levelByCode = new Map(dictRows.rows.map((r) => [r.code, r.state_level]));

  const currentRows = await client.query<{ region_code: string; state_level: StateLevel }>(
    "SELECT region_code, state_level FROM region_state_active",
  );
  const actualByIso = new Map(currentRows.rows.map((r) => [r.region_code, r.state_level]));

  const eventsByIso = new Map<string, RegionEvent[]>();
  for (const row of rows) {
    if (!row.parsedEventId || !row.locations || row.locations.length === 0) continue;
    for (const loc of row.locations) {
      const iso = loc.regionIso;
      if (!iso) continue;
      const byType =
        row.parsedIsActive === false
          ? "green"
          : row.parsedEventType
            ? levelByCode.get(row.parsedEventType) ?? "grey"
            : "grey";
      const event: RegionEvent = {
        postedAt: row.postedAt,
        level: byType,
        eventType: row.parsedEventType,
        rawId: row.rawId,
        parsedEventId: row.parsedEventId,
        cause: row.parsedIsActive === false ? "inactive" : "rule",
      };
      const list = eventsByIso.get(iso) ?? [];
      list.push(event);
      eventsByIso.set(iso, list);
    }
  }

  const selfByIso = new Map<string, StateLevel>();
  const lastCauseByIso = new Map<string, RegionEvent>();
  for (const [iso, list] of eventsByIso) {
    list.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    let self: StateLevel = "grey";
    for (const event of list) {
      self = computeSelfLevel(self, event.level);
      lastCauseByIso.set(iso, event);
    }
    selfByIso.set(iso, self);
  }

  const effectiveByIso = new Map<string, StateLevel>();
  const allIsos = new Set<string>([
    ...Object.keys(adjacency),
    ...actualByIso.keys(),
    ...selfByIso.keys(),
  ]);
  for (const iso of allIsos) {
    const self = selfByIso.get(iso) ?? "grey";
    const neighborSelf = (adjacency[iso] ?? []).map((n) => selfByIso.get(n) ?? "grey");
    effectiveByIso.set(iso, computeEffectiveLevel(self, neighborSelf));
  }

  const mismatches: Array<Record<string, unknown>> = [];
  for (const [iso, expected] of effectiveByIso) {
    const actual = actualByIso.get(iso) ?? "grey";
    if (expected === actual) continue;
    const cause = lastCauseByIso.get(iso);
    mismatches.push({
      iso,
      expected,
      actual,
      self: selfByIso.get(iso) ?? "grey",
      causeType: cause?.eventType ?? null,
      causeKind: cause?.cause ?? null,
      causePostedAt: cause?.postedAt ?? null,
      rawId: cause?.rawId ?? null,
      parsedEventId: cause?.parsedEventId ?? null,
    });
  }
  mismatches.sort((a, b) =>
    String(b.causePostedAt ?? "").localeCompare(String(a.causePostedAt ?? "")),
  );

  const outPath = path.join(root, "reports", "raws_state_validation_result_100_20260602.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        snapshotPath,
        totalSnapshotRows: rows.length,
        totalRegionsCompared: allIsos.size,
        mismatches,
      },
      null,
      2,
    ),
    "utf8",
  );

  await client.end();
  console.log(`VALIDATION_RESULT=${outPath}`);
  console.log(`MISMATCH_COUNT=${mismatches.length}`);
}

void main();
