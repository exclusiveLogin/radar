/** Поднимает tracking-подписчики и runner только для tracking-capability. */
export async function bootTracking<T>(wire: (modules: {
  subscriber: typeof import("../application/subscribers/trackingIngestSubscriber.js");
  launcher: typeof import("../composition/runtime/index.js");
}) => T): Promise<T> {
  const [subscriber, launcher] = await Promise.all([
    import("../application/subscribers/trackingIngestSubscriber.js"),
    import("../composition/runtime/index.js"),
  ]);
  return wire({ subscriber, launcher });
}