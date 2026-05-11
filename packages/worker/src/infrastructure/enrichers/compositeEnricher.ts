import type { ILocationEnricher, LocationCandidate } from "@radar/shared";

/**
 * Use-case:
 * - Последовательный fallback по цепочке enrichers.
 * - Первый успешный результат останавливает цепочку.
 */
export class CompositeEnricher implements ILocationEnricher {
  readonly name = "dadata";

  constructor(private readonly chain: ILocationEnricher[]) {}async enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    for (const enricher of this.chain) {
      const result = await enricher.enrich(input);
      if (result) return result;
    }
    return null;
  }
}
