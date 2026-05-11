import type { ILocationEnricher, IPlaceCacheRepository, LocationCandidate } from "@radar/shared";

/**
 * Use-case:
 * - Сначала cache (in-memory/DB), затем внешний enricher.
 * - Снижает число HTTP-запросов к Dadata/Nominatim при повторяющихся локациях.
 */
export class CachingEnricher implements ILocationEnricher {
  readonly name = "dadata";
  private readonly memory = new Map<string, LocationCandidate>();

  constructor(
    private readonly next: ILocationEnricher,
    private readonly placeCacheRepository?: IPlaceCacheRepository,
  ) {}

  /** Normalizes raw text into cache query key. */
  private normalizeQuery(rawText: string): string {
    return rawText.toLowerCase().trim();
  }

  /** Marks candidate payload with cache-hit source metadata. */
  private markCacheHit(
    candidate: LocationCandidate,
    source: "memory" | "db",
  ): LocationCandidate {
    return {
      ...candidate,
      raw: {
        ...candidate.raw,
        __cacheHit: source,
      },
    };
  }

  /** Attempts to restore cached candidate from persistent cache repository. */
  private async resolveFromRepository(
    queryNorm: string,
  ): Promise<LocationCandidate | null> {
    if (!this.placeCacheRepository) {
      return null;
    }
    const dbHit = await this.placeCacheRepository.get(queryNorm);
    if (!dbHit) {
      return null;
    }
    return this.markCacheHit(
      {
        provider: dbHit.provider,
        queryNorm,
        raw: dbHit.raw,
      },
      "db",
    );
  }

  /** Resolves location using memory cache -> persistent cache -> next enricher. */
  async enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    const queryNorm = this.normalizeQuery(input.rawText);
    const memoryHit = this.memory.get(queryNorm);
    if (memoryHit) {
      return this.markCacheHit(memoryHit, "memory");
    }

    const dbHit = await this.resolveFromRepository(queryNorm);
    if (dbHit) {
      this.memory.set(queryNorm, dbHit);
      return dbHit;
    }

    const resolved = await this.next.enrich(input);
    if (!resolved) return null;

    this.memory.set(queryNorm, resolved);
    if (this.placeCacheRepository) {
      await this.placeCacheRepository.put(
        queryNorm,
        resolved.provider,
        resolved.raw,
      );
    }
    return resolved;
  }
}
