/** Поднимает geo-подписчики и enrichment runner только для geo-capability. */
export async function bootGeo<T>(wire: (modules: {
  subscriber: typeof import("../application/subscribers/geoPlaceIngestSubscriber.js");
  runner: typeof import("../application/geo-parse/placeEnrichmentRunner.js");
  launcher: typeof import("../composition/runtime/index.js");
}) => T): Promise<T> {
  const [subscriber, runner, launcher] = await Promise.all([
    import("../application/subscribers/geoPlaceIngestSubscriber.js"),
    import("../application/geo-parse/placeEnrichmentRunner.js"),
    import("../composition/runtime/index.js"),
  ]);
  return wire({ subscriber, runner, launcher });
}