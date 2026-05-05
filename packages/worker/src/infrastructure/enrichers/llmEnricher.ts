import type { ILocationEnricher, LocationCandidate } from "@radar/shared";

export class LlmEnricher implements ILocationEnricher {
  readonly name = "llm";

  async enrich(_input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    // Заглушка под MCP/LLM-интеграцию в следующих итерациях.
    return null;
  }
}
