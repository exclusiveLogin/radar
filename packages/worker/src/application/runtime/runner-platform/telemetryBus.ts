/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Типизированная шина прогресса — единственный канал, которым platform сообщает наружу
 *          о прогрессе/артефактах. `durable`-конверты складываются в ring buffer и отдаются
 *          поздним подписчикам (poller после reload); `persist`/`ephemeral` — решение потребителя,
 *          platform их не хранит.
 * ---
 */
import type { SignalEnvelope } from "./runnerContracts.js";

export type TelemetrySubscriber<TPayload> = (envelope: SignalEnvelope<TPayload>) => void;

export type TelemetrySubscribeOptions = {
  /** Сразу отдать буфер durable-конвертов (для позднего/переподключившегося подписчика). */
  replayDurable?: boolean;
};

export type TelemetryBus<TPayload> = {
  publish: (envelope: SignalEnvelope<TPayload>) => void;
  subscribe: (
    subscriber: TelemetrySubscriber<TPayload>,
    options?: TelemetrySubscribeOptions,
  ) => () => void;
};

const DURABLE_BUFFER_SIZE = 50;

export function createTelemetryBus<TPayload>(): TelemetryBus<TPayload> {
  const subscribers = new Set<TelemetrySubscriber<TPayload>>();
  const durableBuffer: SignalEnvelope<TPayload>[] = [];

  return {
    publish(envelope) {
      if (envelope.policy.durable) {
        durableBuffer.push(envelope);
        if (durableBuffer.length > DURABLE_BUFFER_SIZE) durableBuffer.shift();
      }
      for (const subscriber of subscribers) subscriber(envelope);
    },
    subscribe(subscriber, options = {}) {
      if (options.replayDurable) {
        for (const envelope of durableBuffer) subscriber(envelope);
      }
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}
