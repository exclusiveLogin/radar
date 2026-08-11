import type * as phaseIngestSubscriber from "../application/subscribers/phaseIngestSubscriber.js";
import type * as runtime from "../composition/runtime/index.js";

/** Поднимает parse-подписчики и runner только для parse-capability. */
export async function bootParse<T>(wire: (modules: {
  phaseSubscriber: typeof phaseIngestSubscriber;
  launcher: typeof runtime;
}) => T): Promise<T> {
  const [phaseSubscriber, launcher] = await Promise.all([
    import("../application/subscribers/phaseIngestSubscriber.js"),
    import("../composition/runtime/index.js"),
  ]);
  return wire({ phaseSubscriber, launcher });
}
