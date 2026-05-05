import * as fs from "node:fs";
import * as path from "node:path";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";

type ParseSummary = {
  totalBlocks: number;
  events: number;
  noise: number;
  meta: number;
  eventShare: number;
};

function resolveInputPath(arg: string): string {
  if (path.isAbsolute(arg)) return arg;
  const local = path.resolve(process.cwd(), arg);
  if (fs.existsSync(local)) return local;
  const repoRelative = path.resolve(process.cwd(), "../../", arg);
  return repoRelative;
}

function buildSummary(kinds: Array<"event" | "noise" | "meta">): ParseSummary {
  const totalBlocks = kinds.length;
  const events = kinds.filter((x) => x === "event").length;
  const noise = kinds.filter((x) => x === "noise").length;
  const meta = kinds.filter((x) => x === "meta").length;
  return {
    totalBlocks,
    events,
    noise,
    meta,
    eventShare: totalBlocks > 0 ? Number((events / totalBlocks).toFixed(4)) : 0,
  };
}

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error("Usage: npm run parse:snap -- <path-to-snap.txt>");
    process.exit(1);
  }

  const filePath = resolveInputPath(inputArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const classifier = new RuleBasedEventClassifier();
  const results = blocks.map((block, index) => ({
    index,
    block,
    result: classifier.classify(block),
  }));
  const summary = buildSummary(results.map((x) => x.result.kind));

  console.log(
    JSON.stringify(
      {
        filePath,
        summary,
        results: results.map((x) => ({
          index: x.index,
          kind: x.result.kind,
          reason: "reason" in x.result ? x.result.reason : undefined,
          event: "event" in x.result ? x.result.event : undefined,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
