/**
 * ---
 * layer: worker/cli
 * kind: eval-harness
 * purpose: Общее ядро A/B-раннера и scorer: резолв блоков двумя конфигами и канонизация.
 * ---
 *
 * SSOT для измерения профита LLM: загрузка фикстур, два geo-резолвера
 * (catalog-only и catalog+llm) и нормализация результата к сравнимой форме.
 * Не трогает БД — работает на артефактах каталога и in-memory кэше.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { EventLocation } from "@radar/shared";
import { splitMessageBlocks } from "../../domain/parsing/index.js";
import { RuleBasedEventClassifier } from "../../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { createParsePipeline } from "../../application/parsing/createParsePipeline.js";
import type { LocationResolutionService } from "../../application/parsing/locationResolutionService.js";
import { loadLlmRuntimeConfig } from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import {
  GeoCatalog,
  type RegionCatalogEntry,
} from "../../infrastructure/geo-catalog/index.js";

/** Режим прогона: дешёвый каталог или каталог + внешние энричеры. */
export type EvalMode = "catalog" | "llm";

/** Блок фикстуры с предрассчитанной классификацией. */
export type FixtureBlock = {
  file: string;
  blockIndex: number;
  text: string;
  kind: "event" | "noise" | "meta";
};

/** Нормализованная локация для сравнения режимов и со золотым набором. */
export type NormalizedLocation = {
  regionCode: string;
  placeName: string | null;
  precision: string;
  source: string;
};

export type EvalRunnerOptions = {
  /** Включить dadata в llm-режиме (по умолчанию выкл — измеряем чистый LLM). */
  withDadata?: boolean;
  /** Включить nominatim в llm-режиме. */
  withNominatim?: boolean;
};

/** Стабильный ключ блока (для golden и сопоставления между прогонами). */
export function blockKey(file: string, blockIndex: number): string {
  return `${file}#${blockIndex}`;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Приводит регион (код/ISO/имя) к каноническому 2-значному коду каталога. */
export function canonicalRegionCode(
  catalog: GeoCatalog,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (catalog.getRegionByCode(trimmed)) return trimmed;

  const isoMatch = trimmed.match(/^ru-(.+)$/i);
  if (isoMatch?.[1] && catalog.getRegionByCode(isoMatch[1])) return isoMatch[1];

  const normalized = normalizeName(trimmed);
  const byName = catalog
    .listRegions()
    .find(
      (entry: RegionCatalogEntry) =>
        normalizeName(entry.name) === normalized ||
        entry.aliases.includes(normalized),
    );
  return byName?.code ?? trimmed;
}

function toNormalized(catalog: GeoCatalog, location: EventLocation): NormalizedLocation {
  return {
    regionCode: canonicalRegionCode(catalog, location.regionCode) ?? location.regionCode,
    placeName: location.placeName ? normalizeName(location.placeName) : null,
    precision: location.precision,
    source: location.source,
  };
}

/** Резолвер одного режима: блок текста → нормализованные локации. */
export type ModeResolver = {
  mode: EvalMode;
  resolve(text: string): Promise<NormalizedLocation[]>;
};

/**
 * Собирает два резолвера поверх общего каталога: catalog-only и catalog+llm.
 * llm-режим читает LLM-конфиг из env и форсит `enabled`.
 */
export function createModeResolvers(
  options: EvalRunnerOptions = {},
): { catalog: ModeResolver; llm: ModeResolver; catalogIndex: GeoCatalog } {
  const catalogIndex = GeoCatalog.loadFromArtifacts();
  const llmRuntimeConfig = { ...loadLlmRuntimeConfig(), enabled: true };

  const catalogPipeline = createParsePipeline({
    enricherFlags: { dadata: false, nominatim: false, llm: false },
    pipelineOrder: ["catalog"],
    llmRuntimeConfig: { ...llmRuntimeConfig, enabled: false },
  });

  const llmOrder: ("catalog" | "llm" | "dadata" | "nominatim")[] = ["catalog", "llm"];
  if (options.withDadata) llmOrder.push("dadata");
  if (options.withNominatim) llmOrder.push("nominatim");

  const llmPipeline = createParsePipeline({
    enricherFlags: {
      dadata: Boolean(options.withDadata),
      nominatim: Boolean(options.withNominatim),
      llm: true,
    },
    pipelineOrder: llmOrder,
    llmRuntimeConfig,
  });

  const wrap = (mode: EvalMode, resolution: LocationResolutionService): ModeResolver => ({
    mode,
    async resolve(text: string) {
      const result = await resolution.resolve(text);
      return result.locations.map((loc) => toNormalized(catalogIndex, loc));
    },
  });

  return {
    catalog: wrap("catalog", catalogPipeline.resolution),
    llm: wrap("llm", llmPipeline.resolution),
    catalogIndex,
  };
}

function resolveInputPath(arg: string): string {
  if (path.isAbsolute(arg)) return arg;
  const local = path.resolve(process.cwd(), arg);
  if (fs.existsSync(local)) return local;
  return path.resolve(process.cwd(), "../../", arg);
}

/** Возвращает список .txt фикстур из файла или каталога. */
export function listFixtureFiles(inputArg: string): string[] {
  const resolved = resolveInputPath(inputArg);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  return fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => path.join(resolved, name));
}

/** Ожидаемая геопривязка одного блока в golden-наборе. */
export type GoldenLabel = {
  regionCode: string;
  /** Имя региона для человекочитаемости разметки (не участвует в сравнении). */
  regionName?: string;
  placeName: string | null;
  /** Ожидаемая точность гео (region/locality/...) — для kind-accuracy. */
  precision?: string;
};

/** Разметка одного блока: null — шум/мета (гео не ожидается). */
export type GoldenBlock = {
  blockIndex: number;
  kind: "event" | "noise" | "meta";
  /** Черновая метка → требует ручной проверки; влияет только на отчёт «reviewed». */
  reviewed: boolean;
  /** Ожидаемые локации; null = гео не ожидается; [] = событие без гео. */
  expected: GoldenLabel[] | null;
};

/** Golden-файл одной фикстуры. */
export type GoldenFile = {
  fixture: string;
  /** Режим, из которого засеяны черновые метки. */
  seededFrom: EvalMode;
  blocks: GoldenBlock[];
};

const GOLDEN_SUFFIX = ".expected.json";

/** Путь golden-файла для фикстуры внутри каталога golden. */
export function goldenPathFor(goldenDir: string, fixture: string): string {
  return path.join(goldenDir, fixture.replace(/\.txt$/, "") + GOLDEN_SUFFIX);
}

/** Читает golden-файл, либо undefined если его нет. */
export function readGoldenFile(filePath: string): GoldenFile | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as GoldenFile;
}

/** Перечисляет golden-файлы каталога. */
export function listGoldenFiles(goldenDir: string): string[] {
  const resolved = resolveInputPath(goldenDir);
  if (!fs.existsSync(resolved)) return [];
  return fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(GOLDEN_SUFFIX))
    .sort()
    .map((name) => path.join(resolved, name));
}

/** Нормализует имя места для сравнения (общая точка с golden). */
export function normalizePlaceName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeName(value);
  return normalized.length > 0 ? normalized : null;
}

/** Разбивает фикстуры на блоки с классификацией kind. */
export function loadFixtureBlocks(files: string[]): FixtureBlock[] {
  const classifier = new RuleBasedEventClassifier();
  const blocks: FixtureBlock[] = [];
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const source = fs.readFileSync(filePath, "utf8");
    splitMessageBlocks(source).forEach((text, blockIndex) => {
      blocks.push({
        file: fileName,
        blockIndex,
        text,
        kind: classifier.classify(text).kind,
      });
    });
  }
  return blocks;
}
