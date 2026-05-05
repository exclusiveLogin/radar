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

  async enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    const queryNorm = input.rawText.toLowerCase().trim();
    const memoryHit = this.memory.get(queryNorm);
    if (memoryHit) return memoryHit;

    if (this.placeCacheRepository) {
      const dbHit = await this.placeCacheRepository.get(queryNorm);
      if (dbHit) {
        const restored: LocationCandidate = {
          provider: "dadata",
          queryNorm,
          raw: dbHit,
        };
        this.memory.set(queryNorm, restored);
        return restored;
      }
    }

    const resolved = await this.next.enrich(input);
    if (!resolved) return null;

    this.memory.set(queryNorm, resolved);
    if (this.placeCacheRepository) {
      await this.placeCacheRepository.put(queryNorm, resolved.raw);
    }
    return resolved;
  }
}
