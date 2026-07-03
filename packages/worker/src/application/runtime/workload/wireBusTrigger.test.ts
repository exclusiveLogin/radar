import assert from "node:assert/strict";
import test from "node:test";
import type { DomainEvent, EventHandler, IEventSubscriber } from "@radar/shared";
import { wireBusTrigger } from "./wireBusTrigger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeBus(): IEventSubscriber & { emit: (eventType: string) => Promise<void> } {
  const handlers = new Map<string, Set<EventHandler>>();
  return {
    subscribe(eventType, handler) {
      const set = handlers.get(eventType) ?? new Set<EventHandler>();
      set.add(handler);
      handlers.set(eventType, set);
      return () => set.delete(handler);
    },
    async emit(eventType) {
      for (const handler of handlers.get(eventType) ?? []) {
        await handler({ type: eventType } as DomainEvent);
      }
    },
  };
}

test("bus event routes into onRoute without debounce", async () => {
  const bus = fakeBus();
  let routed = 0;
  wireBusTrigger(bus, "RawMessageIngested", { onRoute: () => (routed += 1) });
  await bus.emit("RawMessageIngested");
  assert.equal(routed, 1);
});

test("bursts of the same event coalesce into a single debounced route", async () => {
  const bus = fakeBus();
  let routed = 0;
  wireBusTrigger(bus, "MessageParsed", { debounceMs: 15, onRoute: () => (routed += 1) });
  await bus.emit("MessageParsed");
  await bus.emit("MessageParsed");
  await bus.emit("MessageParsed");
  assert.equal(routed, 0);
  await sleep(25);
  assert.equal(routed, 1);
});

test("unwiring stops routing further events", async () => {
  const bus = fakeBus();
  let routed = 0;
  const unwire = wireBusTrigger(bus, "MessageParsed", { onRoute: () => (routed += 1) });
  await bus.emit("MessageParsed");
  unwire();
  await bus.emit("MessageParsed");
  assert.equal(routed, 1);
});
