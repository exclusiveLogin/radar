import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainEvent,
  IEventTransport,
  RadarTopicRoutingKey,
  TransportEventHandler,
  Unsubscribe,
} from "@radar/shared";
import { RADAR_TOPICS, createPipelineStabilizedEvent } from "@radar/shared";
import {
  createMemoryStabilityStore,
  createStabilityEngine,
  pipelineStabilityScope,
} from "../runtime/runner-platform/stabilityEngine.js";
import { createPipelineStabilityObsPort } from "./pipelineStabilityCascade.js";
import { createChannelBackfillCompletedHandler } from "../subscribers/channelBackfillCompletedSubscriber.js";
import { publishDomainEventViaTransport } from "../handlers/ingestEventPublishMode.js";
import { createChannelBackfillCompletedEvent } from "@radar/shared";

function fakeTransport(): IEventTransport & {
  published: Array<{ topic: RadarTopicRoutingKey; events: DomainEvent[] }>;
  handlers: Map<RadarTopicRoutingKey, Set<TransportEventHandler>>;
} {
  const published: Array<{ topic: RadarTopicRoutingKey; events: DomainEvent[] }> = [];
  const handlers = new Map<RadarTopicRoutingKey, Set<TransportEventHandler>>();
  return {
    published,
    handlers,
    async publish(topic, events) {
      published.push({ topic, events });
      for (const handler of handlers.get(topic) ?? []) {
        for (const event of events) await handler(event);
      }
    },
    async publishSignal() {},
    subscribe(topic, handler) {
      const set = handlers.get(topic) ?? new Set();
      set.add(handler);
      handlers.set(topic, set);
      return (() => set.delete(handler)) as Unsubscribe;
    },
    subscribeSignal() {
      return () => {};
    },
    async start() {},
    async stop() {},
  };
}

test("live cascade: parse idle claim publishes on DSL stabilized key once", async () => {
  const transport = fakeTransport();
  const engine = createStabilityEngine(createMemoryStabilityStore());
  let pending = true;
  const obs = createPipelineStabilityObsPort({
    engine,
    transport,
    pipelineKey: "parse",
    stabilizedRoutingKey: RADAR_TOPICS.PARSE_STABILIZED,
    hasPendingWork: async () => pending,
  });

  await obs.onBusy?.();
  pending = false;
  await obs.onIdle?.();
  await obs.onIdle?.();

  const stabilized = transport.published.filter(
    (p) => p.topic === RADAR_TOPICS.PARSE_STABILIZED,
  );
  assert.equal(stabilized.length, 1);
  assert.equal(stabilized[0]!.events[0]!.payload.pipelineKey, "parse");
});

test("live cascade: geo idle with null DSL key claims but does not publish", async () => {
  const transport = fakeTransport();
  const engine = createStabilityEngine(createMemoryStabilityStore());
  const obs = createPipelineStabilityObsPort({
    engine,
    transport,
    pipelineKey: "geo-enrich",
    stabilizedRoutingKey: null,
    hasPendingWork: async () => false,
  });

  await obs.onBusy?.();
  await obs.onIdle?.();

  assert.equal(transport.published.length, 0);
});

test("DSL topics: parse.stabilized wakes tracking; geo.stabilized does not share topic", async () => {
  const transport = fakeTransport();
  let trackingWakes = 0;

  transport.subscribe(RADAR_TOPICS.PARSE_STABILIZED, async () => {
    trackingWakes += 1;
  });

  await publishDomainEventViaTransport(
    transport,
    createPipelineStabilizedEvent({ pipelineKey: "parse" }),
    RADAR_TOPICS.PARSE_STABILIZED,
  );
  // geo без DSL emit — отдельный ключ / null; на parse.stabilized не попадает
  await publishDomainEventViaTransport(
    transport,
    createPipelineStabilizedEvent({ pipelineKey: "geo-enrich" }),
    RADAR_TOPICS.GEO_STABILIZED,
  );

  assert.equal(trackingWakes, 1);
});

test("backfill cascade: ChannelBackfillCompleted clears inProgress and wakes parse", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let parseWakes = 0;
  const handler = createChannelBackfillCompletedHandler({
    cursors: {
      advanceLive: async () => {},
      get: async () => null,
      updateBackfillState: async (_channel, _provider, state) => {
        updates.push(state);
      },
    },
    onWakeParse: () => {
      parseWakes += 1;
    },
  });

  await handler(
    createChannelBackfillCompletedEvent({
      channelId: "11111111-1111-1111-1111-111111111111",
      channelKey: "ch-a",
      providerKey: "tg",
      jobId: "22222222-2222-2222-2222-222222222222",
    }),
  );

  assert.equal(parseWakes, 1);
  assert.equal(updates[0]?.inProgress, false);
  assert.equal(updates[0]?.status, "completed");
});

test("stability scope keys are distinct for pipeline vs channel", () => {
  assert.notEqual(
    pipelineStabilityScope("parse"),
    `channel-backfill:11111111-1111-1111-1111-111111111111`,
  );
});
