#!/usr/bin/env node
import { run } from "./utils.mjs";

function step(title) {
  console.log(`\n\x1b[36m[geo:init] ${title}\x1b[0m`);
}

function runNpm(args) {
  if (process.platform === "win32") {
    run("cmd", ["/c", "npm", ...args]);
    return;
  }
  run("npm", args);
}

async function main() {
  step("vendor clone");
  runNpm(["run", "geo:vendor"]);

  step("sync artifacts");
  runNpm(["run", "geo:sync"]);

  step("verify artifacts");
  runNpm(["run", "geo:verify"]);

  step("seed geo_dataset_file");
  runNpm(["run", "geo:seed"]);

  step("plan db sync");
  runNpm(["run", "geo:db:plan"]);

  step("apply db sync");
  runNpm(["run", "geo:db:apply"]);

  console.log("\n\x1b[32mgeo:init completed\x1b[0m");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
