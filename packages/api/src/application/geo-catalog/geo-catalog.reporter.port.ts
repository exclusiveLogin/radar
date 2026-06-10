/** Факт БД и persist после apply (не путать с plan/snapshot). */
export type GeoCatalogStepDebug = {
  snapshotPlaces?: number;
  placeRowsBuilt?: number;
  unresolvedPlaceDrafts?: number;
  planPlaces?: { added: number; updated: number; noop: number };
  dbPlacesByKind?: Record<string, number>;
};

/** Отчёт о ходе geo:catalog:import (4 шага). */
export type GeoCatalogStepStats = {
  step: string;
  regions?: number;
  places?: number;
  aliases?: number;
  features?: number;
  linked?: number;
  orphans?: number;
  edges?: number;
  durationMs: number;
  /** Реальные счётчики persist/БД — видно расхождение с plan. */
  debug?: GeoCatalogStepDebug;
};

export interface IGeoCatalogImportReporter {
  stepBegin(step: string, index: number, total: number): void;
  stepDone(stats: GeoCatalogStepStats): void;
  finish(steps: GeoCatalogStepStats[]): void;
}

/** Отчёт о ходе geo:catalog:reset. */
export type GeoCatalogResetStepStats = {
  step: string;
  rows: number;
  durationMs: number;
};

export interface IGeoCatalogResetReporter {
  stepBegin(step: string, index: number, total: number): void;
  stepDone(stats: GeoCatalogResetStepStats): void;
  finish(totals: Record<string, number>, steps: GeoCatalogResetStepStats[]): void;
}
