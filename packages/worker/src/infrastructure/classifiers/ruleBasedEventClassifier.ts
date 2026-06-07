import type { ClassifiedPost, IEventClassifier } from "@radar/shared";
import { classifyContentKind, parsePost, stripSignature } from "../../domain/parsing/index.js";
import { extractPvoStats } from "../../domain/parsing/extractPvoStats.js";
import type { RegionCatalog } from "../geo-catalog/regionCatalog.js";

/**
 * Правиловый классификатор сообщений:
 * чистка подписи → определение типа контента → парсинг event-полей.
 * При наличии regionCatalog дополнительно обогащает extras.pvo для pvo_report-событий.
 */
export class RuleBasedEventClassifier implements IEventClassifier {
  constructor(private readonly regionCatalog: RegionCatalog | null = null) {}

  classify(rawPost: string): ClassifiedPost {
    const cleaned = stripSignature(rawPost);
    const kind = classifyContentKind(cleaned);
    if (kind === "meta") {
      return { kind: "meta", reason: "meta_content" };
    }
    if (kind === "noise") {
      return { kind: "noise", reason: "noise_content" };
    }

    const result = parsePost(cleaned);
    if (result.kind !== "event" || result.event.eventType !== "pvo_report") {
      return result;
    }

    // Обогащаем extras.pvo для сводных отчётов ПВО.
    const pvo = this.regionCatalog
      ? extractPvoStats(cleaned, this.regionCatalog)
      : undefined;

    return {
      ...result,
      event: {
        ...result.event,
        extras: { ...result.event.extras, pvo },
      },
    };
  }
}
