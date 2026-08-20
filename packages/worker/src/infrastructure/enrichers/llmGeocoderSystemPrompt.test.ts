import assert from "node:assert/strict";
import test from "node:test";
import { eventSubjectSchema, geoEventCategorySchema } from "@radar/shared";
import { LLM_GEOCODER_SYSTEM_PROMPT } from "./llmGeocoderSystemPrompt.js";

test("LLM_GEOCODER_SYSTEM_PROMPT содержит полный geoEventCategory enum", () => {
  for (const value of geoEventCategorySchema.options) {
    assert.match(
      LLM_GEOCODER_SYSTEM_PROMPT,
      new RegExp(`\\b${value}\\b`),
      `missing eventCategory ${value}`,
    );
  }
});

test("LLM_GEOCODER_SYSTEM_PROMPT содержит eventSubject enum", () => {
  for (const value of eventSubjectSchema.options) {
    assert.match(
      LLM_GEOCODER_SYSTEM_PROMPT,
      new RegExp(`\\b${value}\\b`),
      `missing eventSubject ${value}`,
    );
  }
});

test("LLM_GEOCODER_SYSTEM_PROMPT запрещает noise на оперативке", () => {
  assert.match(LLM_GEOCODER_SYSTEM_PROMPT, /ЗАПРЕТ:.*noise/s);
  assert.match(LLM_GEOCODER_SYSTEM_PROMPT, /Фиксация БПЛА.*fixation/s);
  assert.match(LLM_GEOCODER_SYSTEM_PROMPT, /несколько явных субъектов/i);
});
