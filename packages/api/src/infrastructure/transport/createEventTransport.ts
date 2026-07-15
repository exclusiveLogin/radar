import type { DataSource } from "typeorm";
import type { DeploymentTransport } from "@radar/shared";
import { resolveRmqConsumerSuffix } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import { createPgTransportDedup } from "./pgTransportDedup.js";
import { createRmqEventTransport } from "./rmqEventTransport.js";

/** API: admin/control всегда через RMQ (dev --full: worker in-process, API rmq). */
export function createApiEventTransport(
  transport: DeploymentTransport,
  dataSource?: DataSource,
): IEventTransport {
  const pgDedup = transport.rmq.dedupTable && dataSource ? createPgTransportDedup(dataSource) : undefined;
  return createRmqEventTransport(transport.rmq, pgDedup, resolveRmqConsumerSuffix("api"));
}
