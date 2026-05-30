import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalRegionCode,
  parseKladrSubjectPrefix,
} from "./regionLookupCode.js";

test("parseKladrSubjectPrefix — LLM и полный kladr_id", () => {
  assert.equal(parseKladrSubjectPrefix("73"), "73");
  assert.equal(parseKladrSubjectPrefix("7"), "07");
  assert.equal(parseKladrSubjectPrefix("7300000000000"), "73");
  assert.equal(parseKladrSubjectPrefix("RU-ULY"), null);
  assert.equal(parseKladrSubjectPrefix(""), null);
});

test("canonicalRegionCode предпочитает ISO", () => {
  assert.equal(
    canonicalRegionCode({ iso: "RU-ULY", code: "d8327a56-80de-4df2-815c-4f6ab1224c50" }),
    "RU-ULY",
  );
  assert.equal(canonicalRegionCode({ code: "31" }), "31");
});
