import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeContribution,
  SOURCE_TRUST,
  type StatusDictionaryRecord,
} from "@radar/shared";
import { bridgeEventCategoryToCode } from "../../domain/region-state/eventCategoryBridge.js";

/** Копия merge-логики проекции для unit-теста без Nest. */
function resolveEffectiveStatusCode(
  ruleEventType: string,
  eventCategory: "other" | "threat" | undefined,
  dictionary: StatusDictionaryRecord[],
  levelOf: (code: string) => string,
): string {
  let merged = {};
  if (levelOf(ruleEventType) !== "grey") {
    merged = mergeContribution(merged, {
      eventType: {
        value: ruleEventType,
        source: "rule",
        trust: SOURCE_TRUST.rule,
        precision: "attribute",
      },
    });
  }
  const llmCategory = eventCategory === "other" ? "all_clear" : eventCategory;
  const llmCode = llmCategory
    ? bridgeEventCategoryToCode(llmCategory, dictionary)
    : null;
  if (llmCode) {
    merged = mergeContribution(merged, {
      eventType: {
        value: llmCode,
        source: "llm",
        trust: SOURCE_TRUST.llm,
        precision: "attribute",
      },
    });
  }
  return (merged as { eventType?: { value: string } }).eventType?.value ?? ruleEventType;
}

const dictionary = [
  { code: "attention", stateLevel: "yellow", isActive: true, priority: 10 },
  { code: "cleared", stateLevel: "green", isActive: true, priority: 1 },
] as StatusDictionaryRecord[];

const levelOf = (code: string) =>
  dictionary.find((e) => e.code === code)?.stateLevel ?? "grey";

test("LLM other перебивает rule attention (trust LLM > rule)", () => {
  const code = resolveEffectiveStatusCode(
    "attention",
    "other",
    dictionary,
    levelOf,
  );
  assert.equal(code, "cleared");
});

test("rule attention без LLM остаётся", () => {
  const code = resolveEffectiveStatusCode(
    "attention",
    undefined,
    dictionary,
    levelOf,
  );
  assert.equal(code, "attention");
});
