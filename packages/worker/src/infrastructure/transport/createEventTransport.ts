import type { DataSource } from "typeorm";
import type { DeploymentManifest, DeploymentTransport } from "@radar/shared";
import { InProcessEventTransport, resolveRmqConsumerSuffix } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import type { WorkerRole } from "../config/workerRole.js";
import { createPgTransportDedup } from "./pgTransportDedup.js";
import { createRmqEventTransport } from "./rmqEventTransport.js";

export type CreateEventTransportInput = {
  transport: DeploymentTransport;
  workerRole: WorkerRole;
  /** PG dedup L2 для RMQ consumer. */
  dataSource?: DataSource;
  /** API всегда rmq для admin/control; worker role=all может быть in-process для cascade. */
  forceRmq?: boolean;
};

/** Fail-fast: split role без rmq. */
export function assertTransportCompatible(role: WorkerRole, transport: DeploymentTransport): void {
  if (role !== "all" && transport.kind === "in-process") {
    throw new Error(`RADAR_WORKER_ROLE=${role} requires transport.kind=rmq`);
  }
}

export function createEventTransport(input: CreateEventTransportInput): IEventTransport {
  const { transport, workerRole, forceRmq = false, dataSource } = input;
  assertTransportCompatible(workerRole, transport);
  const useRmq = forceRmq || transport.kind === "rmq" || workerRole !== "all";
  if (useRmq) {
    const pgDedup = transport.rmq.dedupTable && dataSource ? createPgTransportDedup(dataSource) : undefined;
    return createRmqEventTransport(transport.rmq, pgDedup, resolveRmqConsumerSuffix(workerRole));
  }
  return new InProcessEventTransport();
}

export function resolveTransportFromManifest(manifest: DeploymentManifest): DeploymentTransport {
  return manifest.transport;
}
