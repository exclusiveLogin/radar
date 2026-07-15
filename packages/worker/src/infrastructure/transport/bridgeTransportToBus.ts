import type { InProcessEventBus } from "@radar/shared";
import type {
  IEventTransport,
  RadarTopicRoutingKey,
  TransportSubscribeOptions,
} from "@radar/shared";

/** RMQ consumer → local in-process bus (parse/geo split containers). */
export function bridgeTransportTopicToBus(
  transport: IEventTransport,
  bus: InProcessEventBus,
  routingKey: RadarTopicRoutingKey,
  options?: TransportSubscribeOptions,
) {
  return transport.subscribe(
    routingKey,
    async (event) => {
      await bus.publish([event]);
    },
    options,
  );
}
