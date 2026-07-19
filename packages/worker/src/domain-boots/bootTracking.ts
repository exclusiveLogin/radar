import type * as trackingIngestSubscriber from "../application/subscribers/trackingIngestSubscriber.js";
import type * as runtime from "../composition/runtime/index.js";

/** Поднимает tracking-подписчики и runner только для tracking-capability. */
export async function bootTracking<T>(wire: (modules: {
  subscriber: typeof trackingIngestSubscriber;
  launcher: typeof runtime;
}) => T): Promise<T> {
  const [subscriber, launcher] = await Promise.all([
    import("../application/subscribers/trackingIngestSubscriber.js"),
    import("../composition/runtime/index.js"),
  ]);
  return wire({ subscriber, launcher });
}