import * as path from "node:path";export function resolveSessionFilePath(repoRoot: string): string {
  const rel = process.env.TELEGRAM_SESSION_FILE?.trim() || ".telegram/session";
  return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
}
