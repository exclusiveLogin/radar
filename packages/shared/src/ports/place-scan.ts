import type { PlaceRecord } from "./geo-repositories.js";

/** Запись каталога для in-memory geo scan (read-side). */
export type PlaceScanEntry = {
  placeId: string;
  regionId: string;
  regionIso: string;
  kind: PlaceRecord["kind"];
  name: string;
  nameStem: string;
  /** Краткое имя субъекта из regions.short_name — только для kind=region (ADR-012). */
  regionShortName?: string;
  nameWithType?: string;
  centroidLat?: number;
  centroidLon?: number;
};

export type TextSpan = {
  start: number;
  end: number;
  matchedText: string;
};

/** Подсказка уровня НП из канальной формы (мо, район, го). */
export type PlaceKindHint =
  | "district"
  | "city"
  | "region";

export type GeoSpanToken = TextSpan & {
  kindHint?: PlaceKindHint;
  /** stem для lookup после preprocess */
  lookupLabel: string;
};

export type PlaceScanHit = {
  entry: PlaceScanEntry;
  span: TextSpan;
  geoImprecise?: boolean;
};

export type PlaceResolveContext = {
  /** ISO субъекта из явного region-hit в тексте */
  regionScopeIso?: string;
  regionScopeId?: string;
  /** Все явные region ISO в сообщении (RVK) */
  explicitRegionIsos?: string[];
};

/** Read-side geo scan для parse — SSOT runtime, не persistence. */
export interface IPlaceScanPort {
  matchRegions(text: string): PlaceScanHit[];
  matchPlaces(text: string, ctx: PlaceResolveContext): PlaceScanHit[];
  regionIsoForPlace(placeId: string): Promise<string | null>;
  revision(): string;
}

export type FindByStemGlobalOptions = {
  minKind: PlaceRecord["kind"];
  maxKind?: PlaceRecord["kind"];
  regionId?: string;
  preferKind?: PlaceRecord["kind"];
};
