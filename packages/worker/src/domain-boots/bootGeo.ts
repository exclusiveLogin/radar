import type * as geoPlaceIngestSubscriber from "../application/subscribers/geoPlaceIngestSubscriber.js";
import type * as placeEnrichmentRunner from "../application/geo-parse/placeEnrichmentRunner.js";
import type * as runtime from "../composition/runtime/index.js";

/** Поднимает geo-подписчики и enrichment runner только для geo-capability. */
export async function bootGeo<T>(wire: (modules: {
  subscriber: typeof geoPlaceIngestSubscriber;
  runner: typeof placeEnrichmentRunner;
  launcher: typeof runtime;
}) => T): Promise<T> {
  const [subscriber, runner, launcher] = await Promise.all([
    import("../application/subscribers/geoPlaceIngestSubscriber.js"),
    import("../application/geo-parse/placeEnrichmentRunner.js"),
    import("../composition/runtime/index.js"),
  ]);
  return wire({ subscriber, runner, launcher });
}