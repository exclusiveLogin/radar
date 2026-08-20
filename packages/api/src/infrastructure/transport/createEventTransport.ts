import type { DataSource } from "typeorm";
import type { DeploymentTransport } from "@radar/shared";
import { resolveRmqConsumerSuffix } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import { createRmqEventTransport } from "@radar/transport-rmq";
import { createPgTransportDedup } from "./pgTransportDedup.js";

/** API admin/control publishes events through RMQ. */
export function createApiEventTransport(
  transport: DeploymentTransport,
  dataSource?: DataSource,
): IEventTransport {
  const pgDedup = transport.rmq.dedupTable && dataSource ? createPgTransportDedup(dataSource) : undefined;
  return createRmqEventTransport(transport.rmq, pgDedup, resolveRmqConsumerSuffix("api"));
}
