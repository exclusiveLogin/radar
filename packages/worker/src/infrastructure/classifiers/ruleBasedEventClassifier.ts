import type { ClassifiedPost, IEventClassifier } from "@radar/shared";
import { classifyContentKind, parsePost, stripSignature } from "../../domain/parsing/index.js";

// Правиловый классификатор сообщений:
// чистка подписи -> определение типа контента -> парсинг event-полей.
export class RuleBasedEventClassifier implements IEventClassifier {classify(rawPost: string): ClassifiedPost {
    const cleaned = stripSignature(rawPost);
    const kind = classifyContentKind(cleaned);
    if (kind === "meta") {
      return { kind: "meta", reason: "meta_content" };
    }
    if (kind === "noise") {
      return { kind: "noise", reason: "noise_content" };
    }
    return parsePost(cleaned);
  }
}
