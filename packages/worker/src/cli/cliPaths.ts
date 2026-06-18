import * as fs from "node:fs";
import * as path from "node:path";

/** Резолв пути к фикстуре: cwd → repo root. */
export function resolveInputPath(arg: string): string {
  if (path.isAbsolute(arg)) return arg;
  const local = path.resolve(process.cwd(), arg);
  if (fs.existsSync(local)) return local;
  return path.resolve(process.cwd(), "../../", arg);
}
