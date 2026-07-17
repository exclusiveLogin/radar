/** Поднимает parse-подписчики и runner только для parse-capability. */
export async function bootParse<T>(wire: (modules: {
  phaseSubscriber: typeof import("../application/subscribers/phaseIngestSubscriber.js");
  launcher: typeof import("../composition/runtime/index.js");
  poller: typeof import("../application/phases/phaseManualRunPoller.js");
}) => T): Promise<T> {
  const [phaseSubscriber, launcher, poller] = await Promise.all([
    import("../application/subscribers/phaseIngestSubscriber.js"),
    import("../composition/runtime/index.js"),
    import("../application/phases/phaseManualRunPoller.js"),
  ]);
  return wire({ phaseSubscriber, launcher, poller });
}