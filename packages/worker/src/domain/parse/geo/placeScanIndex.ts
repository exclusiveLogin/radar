import type { PlaceRecord, PlaceScanEntry, PlaceScanHit, TextSpan } from "@radar/shared";
import {
  isGeoPhraseStopword,
  kindMeetsFloor,
  placeStem,
  sortPlaceScanEntriesStable,
} from "@radar/shared";
import { isGarbageIngestPlaceName } from "../../parsing/channelCityListPromo.js";

type PhraseIndexRow = {
  phrase: string;
  phraseLower: string;
  entries: PlaceScanEntry[];
};

/**
 * ADR-012: без regionScope — kind ≥ city; locality/settlement только если имя уникально в каталоге.
 */
function resolvePhraseCandidates(
  entries: PlaceScanEntry[],
  minKind: PlaceRecord["kind"],
  phraseLower: string,
): PlaceScanEntry[] {
  const cityPlus = entries.filter(
    (e) => e.kind !== "region" && kindMeetsFloor(e.kind, minKind),
  );
  if (cityPlus.length > 0) return cityPlus;

  if (isGeoPhraseStopword(phraseLower) || phraseLower.length < 4) {
    return [];
  }

  // Голое «Республика» и прочий ingest-мусор — не locality fallback (субъекты — kind=region, другой путь).
  if (isGarbageIngestPlaceName(phraseLower)) {
    return [];
  }

  const explicitSettlement = entries.filter(
    (e) => e.kind === "locality" || e.kind === "settlement",
  );
  if (explicitSettlement.length === 1) return explicitSettlement;

  return [];
}

/** In-memory longest-match index по фразам каталога. */
export class PlaceScanIndex {
  private readonly phraseRows: PhraseIndexRow[];
  readonly entriesByStem: Map<string, PlaceScanEntry[]>;
  readonly entriesById: Map<string, PlaceScanEntry>;
  readonly regionEntries: PlaceScanEntry[];

  constructor(entries: PlaceScanEntry[]) {
    this.entriesById = new Map(entries.map((e) => [e.placeId, e]));
    this.regionEntries = entries.filter((e) => e.kind === "region");
    this.entriesByStem = new Map();

    for (const entry of entries) {
      const stem = entry.nameStem || placeStem(entry.name);
      const list = this.entriesByStem.get(stem) ?? [];
      list.push(entry);
      this.entriesByStem.set(stem, list);
    }

    const phraseMap = new Map<string, PlaceScanEntry[]>();
    for (const entry of entries) {
      const phrases = new Set<string>([entry.name]);
      if (entry.nameWithType) phrases.add(entry.nameWithType);
      // Краткое имя субъекта (regions.short_name) — только region-place, без place_aliases.
      if (entry.kind === "region" && entry.regionShortName) {
        phrases.add(entry.regionShortName);
      }
      for (const phrase of phrases) {
        const key = phrase.toLowerCase().trim();
        if (key.length < 3) continue;
        const list = phraseMap.get(key) ?? [];
        list.push(entry);
        phraseMap.set(key, list);
      }
    }

    this.phraseRows = [...phraseMap.entries()]
      .map(([phrase, ents]) => ({
        phrase,
        phraseLower: phrase.toLowerCase(),
        entries: ents,
      }))
      .sort((a, b) => b.phrase.length - a.phrase.length);
  }

  /** Longest-match по фразам; phraseMinKind — ADR-012 floor для place-phrase. */
  matchPhrases(
    text: string,
    kindFilter?: (e: PlaceScanEntry) => boolean,
    phraseMinKind: PlaceRecord["kind"] = "city",
  ): PlaceScanHit[] {
    const lower = text.toLowerCase();
    const hits: PlaceScanHit[] = [];
    const occupied: Array<[number, number]> = [];

    const overlaps = (start: number, end: number) =>
      occupied.some(([s, e]) => start < e && end > s);

    for (const row of this.phraseRows) {
      let from = 0;
      while (from < lower.length) {
        const idx = lower.indexOf(row.phraseLower, from);
        if (idx < 0) break;
        const start = idx;
        const end = idx + row.phrase.length;
        const before = idx > 0 ? lower[idx - 1]! : " ";
        const after = end < lower.length ? lower[end]! : " ";
        const wordChar = /[\p{L}\p{N}_]/u;
        if (wordChar.test(before) || wordChar.test(after)) {
          from = idx + 1;
          continue;
        }
        if (!overlaps(start, end)) {
          const filtered = kindFilter ? row.entries.filter(kindFilter) : row.entries;
          const candidates =
            kindFilter && filtered.length > 0 && filtered.every((e) => e.kind !== "region")
              ? resolvePhraseCandidates(filtered, phraseMinKind, row.phraseLower)
              : filtered;
          if (candidates.length > 0) {
            const sorted = sortPlaceScanEntriesStable(candidates);
            const entry = sorted[0]!;
            occupied.push([start, end]);
            hits.push({
              entry,
              span: { start, end, matchedText: text.slice(start, end) },
              geoImprecise: sorted.length > 1,
            });
          }
        }
        from = idx + 1;
      }
    }

    return hits.sort((a, b) => a.span.start - b.span.start);
  }

  matchRegions(text: string): PlaceScanHit[] {
    return this.matchPhrases(text, (e) => e.kind === "region");
  }

  /**
   * Phrase-match для place: ADR-012 — без regionScope только kind ≥ city
   * (locality/settlement не матчатся по голому имени).
   */
  matchPlacesByPhrase(
    text: string,
    options?: { minKind?: PlaceRecord["kind"] },
  ): PlaceScanHit[] {
    const minKind = options?.minKind ?? "city";
    return this.matchPhrases(text, (e) => e.kind !== "region", minKind);
  }
}

export function mergeSpanHit(
  entry: PlaceScanEntry,
  span: TextSpan,
  geoImprecise?: boolean,
): PlaceScanHit {
  return { entry, span, geoImprecise };
}
