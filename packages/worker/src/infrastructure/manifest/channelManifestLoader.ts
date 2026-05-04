import * as fs from "node:fs";
import * as path from "node:path";
import { channelManifestSchema, type ChannelManifest } from "@radar/shared";

const DEFAULT_REL = path.join(".radar", "channels.manifest.json");

/**
 * Загрузка манифеста каналов (JSON + Zod).
 * Если файла нет — `null` (воркер может работать только на auth/smoke).
 */
export function loadChannelManifest(repoRoot: string): ChannelManifest | null {
  const fromEnv = process.env.RADAR_CHANNEL_MANIFEST?.trim();
  const abs = fromEnv
    ? path.isAbsolute(fromEnv)
      ? fromEnv
      : path.join(repoRoot, fromEnv)
    : path.join(repoRoot, DEFAULT_REL);

  if (!fs.existsSync(abs)) {
    return null;
  }

  const raw: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
  return channelManifestSchema.parse(raw);
}
