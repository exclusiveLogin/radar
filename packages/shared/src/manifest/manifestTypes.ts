import type { z } from "zod";

/** Путь к массиву → поле-ключ для merge/overlay (напр. runners.pipelines → pipelineKey). */
export type ManifestArrayKeys = Record<string, string>;

/** Минимальный контракт zod-схемы для loadDomainManifest. */
export type ManifestSchema<T> = {
  parse: (data: unknown) => T;
};

export type LoadDomainManifestOptions<T> = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  /** Базовое имя файла без суффикса: deployment → deployment.manifest.json */
  fileBase: string;
  /** Префикс env overlay: DEPLOY → DEPLOY__infra__obs__mode */
  envPrefix: string;
  schema: ManifestSchema<T>;
  defaults: T;
  arrayKeys?: ManifestArrayKeys;
  /** BC: дополнительные local-файлы (напр. deployment.local.json). */
  legacyLocalFiles?: string[];
  /** BC: явный путь к base manifest вместо {fileBase}.manifest.json */
  baseManifestPath?: string;
};
