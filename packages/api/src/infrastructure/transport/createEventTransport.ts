import type { DeploymentTransport } from "@radar/shared";
import { InProcessEventTransport } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import { RmqEventTransport } from "./rmqEventTransport.js";

/** API: admin/control всегда через RMQ (dev --full: worker in-process, API rmq). */
export function createApiEventTransport(transport: DeploymentTransport): IEventTransport {
  if (transport.kind === "in-process") {
    return new RmqEventTransport(transport.rmq);
  }
  return new RmqEventTransport(transport.rmq);
}
