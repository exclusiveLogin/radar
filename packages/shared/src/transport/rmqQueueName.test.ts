import assert from "node:assert/strict";
import test from "node:test";
import {
  PIPELINE_RMQ_QUEUE_SUFFIX,
  resolveRmqConsumerSuffix,
  resolveRmqQueueSuffixForPhaseScope,
  rmqQueueName,
  rmqTopicSlug,
} from "./rmqQueueName.js";

test("rmqTopicSlug replaces dots with underscores", () => {
  assert.equal(rmqTopicSlug("radar.message.parsed"), "radar_message_parsed");
});

test("rmqQueueName builds per-role queue", () => {
  assert.equal(rmqQueueName("radar.message.parsed", "geo"), "radar_message_parsed.geo");
  assert.equal(rmqQueueName("radar.raw.ingested", "parse"), "radar_raw_ingested.parse");
});

test("resolveRmqConsumerSuffix maps roles", () => {
  assert.equal(resolveRmqConsumerSuffix("all"), "monolith");
  assert.equal(resolveRmqConsumerSuffix("parse"), "parse");
  assert.equal(resolveRmqConsumerSuffix("geo"), "geo");
  assert.equal(resolveRmqConsumerSuffix("api"), "api");
  assert.equal(resolveRmqConsumerSuffix("phase"), "parse");
});

test("phase scope and pipeline suffixes", () => {
  assert.equal(resolveRmqQueueSuffixForPhaseScope("ingestParse"), "parse");
  assert.equal(resolveRmqQueueSuffixForPhaseScope("geoParse"), "geo");
  assert.equal(PIPELINE_RMQ_QUEUE_SUFFIX.parse, "parse");
  assert.equal(PIPELINE_RMQ_QUEUE_SUFFIX["geo-enrich"], "geo");
  assert.equal(PIPELINE_RMQ_QUEUE_SUFFIX.tracking, "tracking");
});
