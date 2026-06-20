import { stripSignature } from "../parsing/stripSignature.js";
import { classifyContentKind } from "../parsing/classifyContentKind.js";
import { segmentMessage } from "./segmenter/segmentMessage.js";
import { stripInlineChannelNoise } from "./stripChannelNoise.js";

export type GroomResult =
  | { kind: "meta" | "noise"; reason: string }
  | { kind: "event"; groomedText: string; blocks: ReturnType<typeof segmentMessage> };

/** Подготовка текста: подпись, inline promo, сегментация, отсев promo/footer. */
export function groomMessage(rawPost: string): GroomResult {
  const afterSignature = stripSignature(rawPost);
  const cleaned = stripInlineChannelNoise(afterSignature);
  const contentKind = classifyContentKind(cleaned);
  if (contentKind === "meta") {
    return { kind: "meta", reason: "meta_content" };
  }
  if (contentKind === "noise") {
    return { kind: "noise", reason: "noise_content" };
  }

  const blocks = segmentMessage(cleaned);
  const groomedText = blocks
    .filter((block) => block.kind !== "promo" && block.kind !== "footer")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return { kind: "event", groomedText, blocks };
}
