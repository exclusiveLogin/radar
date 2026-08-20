import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CreateIngestBinding,
  CreateIngestProvider,
  IChannelRepository,
  IIngestBindingRepository,
  IIngestProviderRepository,
  IngestManifest,
} from "@radar/shared";
import { loadIngestManifestFromDomain } from "@radar/shared/manifest/domains/ingest.loader.js";

const DEFAULT_REL = path.join(".radar", "ingest.manifest.json");
/** Bundled шаблон с каналами Radar (PF, Russia, RVK, RRPFO) — bootstrap при первом import. */
const BUNDLED_DEFAULT_REL = path.join(
  "docs",
  "examples",
  "ingest.manifest.radar-channels-mtproxy.json",
);

export function resolveIngestManifestPath(repoRoot: string): string {
  const fromEnv = process.env.RADAR_INGEST_MANIFEST?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(repoRoot, fromEnv);
  }
  return path.join(repoRoot, DEFAULT_REL);
}

/**
 * Если локального `.radar/ingest.manifest.json` нет — создаём из bundled шаблона.
 * Файл gitignored; шаблон в репозитории — SSOT для dev/bootstrap.
 */
function ensureIngestManifestFile(repoRoot: string): string | null {
  const abs = resolveIngestManifestPath(repoRoot);
  if (fs.existsSync(abs)) return abs;

  const bundled = path.join(repoRoot, BUNDLED_DEFAULT_REL);
  if (!fs.existsSync(bundled)) return null;

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(bundled, abs);
  console.warn(
    `Ingest manifest: создан ${DEFAULT_REL} из ${BUNDLED_DEFAULT_REL}. Отредактируйте при необходимости.`,
  );
  return abs;
}

/** Загрузка ingest manifest v2 (JSON + Zod). */
export function loadIngestManifest(repoRoot: string): IngestManifest | null {
  const abs = ensureIngestManifestFile(repoRoot);
  if (!abs) {
    return null;
  }
  return loadIngestManifestFromDomain({ repoRoot });
}

/**
 * Import: upsert всех entries с `persist: true` в БД (idempotent).
 */
export async function importIngestManifest(
  manifest: IngestManifest,
  repos: {
    providers: IIngestProviderRepository;
    bindings: IIngestBindingRepository;
    channels: IChannelRepository;
  },
): Promise<{ providers: number; channels: number; bindings: number }> {
  let providers = 0;
  let channels = 0;
  let bindings = 0;

  for (const entry of manifest.entries) {
    if (!entry.persist) continue;

    let providerId: string | undefined;
    if (entry.provider) {
      const existing = await repos.providers.findByKey(entry.provider.key);
      const record = existing ?? (await repos.providers.create(entry.provider as CreateIngestProvider));
      providerId = record.id;
      providers += existing ? 0 : 1;
    }

    if (entry.channel) {
      await repos.channels.upsert({
        key: entry.channel.key,
        telegramTarget: entry.channel.telegramTarget,
        title: entry.channel.title ?? entry.channel.key,
        enabled: entry.channel.enabled ?? true,
        parseOverrides: entry.channel.parseOverrides ?? {},
        providerId: providerId ?? null,
        sourceKind: "telegram",
      });
      channels += 1;
    }

    if (entry.binding && providerId) {
      const channelKey =
        entry.binding.channelKey ?? entry.channel?.key;
      if (!channelKey) {
        console.warn("Skip binding без channelKey:", entry.binding.bindingKey);
        continue;
      }
      const existingBindings = await repos.bindings.listByProvider(providerId);
      const dup = existingBindings.find((b) => b.bindingKey === entry.binding!.bindingKey);
      if (!dup) {
        await repos.bindings.create(providerId, {
          ...(entry.binding as CreateIngestBinding),
          channelKey,
        });
        bindings += 1;
      }
    }
  }

  return { providers, channels, bindings };
}

/**
 * Export: сформировать manifest из текущего состояния БД.
 */
export async function exportIngestManifest(repos: {
  providers: IIngestProviderRepository;
  bindings: IIngestBindingRepository;
  channels: IChannelRepository;
}): Promise<IngestManifest> {
  const providers = await repos.providers.listAll();
  const entries: IngestManifest["entries"] = [];

  for (const provider of providers) {
    const providerBindings = await repos.bindings.listByProvider(provider.id);
    for (const binding of providerBindings) {
      const channel = binding.channelId
        ? await repos.channels.findById(binding.channelId)
        : null;
      entries.push({
        persist: true,
        provider: {
          key: provider.key,
          title: provider.title,
          adapterKind: provider.adapterKind,
          adapterConfig: provider.adapterConfig,
          credentialRefs: provider.credentialRefs,
        },
        channel: channel
          ? {
              key: channel.key,
              telegramTarget: channel.telegramTarget,
              title: channel.title ?? undefined,
              enabled: channel.enabled,
              parseOverrides: channel.parseOverrides as Record<string, unknown>,
            }
          : undefined,
        binding: {
          bindingKey: binding.bindingKey,
          externalTarget: binding.externalTarget,
          bindingMode: binding.bindingMode,
          enabled: binding.enabled,
          parseOverrides: binding.parseOverrides,
          adapterBinding: binding.adapterBinding,
          channelKey: channel?.key,
        },
      });
    }
  }

  return { version: 2, entries };
}

export function writeIngestManifest(repoRoot: string, manifest: IngestManifest): string {
  const abs = resolveIngestManifestPath(repoRoot);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(manifest, null, 2), "utf8");
  return abs;
}
