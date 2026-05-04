import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

export function loadRootEnv(repoRoot: string): void {
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}
