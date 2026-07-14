import type { DeploymentManifest, DeploymentTransport } from "@radar/shared";
import { InProcessEventTransport } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import type { WorkerRole } from "../config/workerRole.js";
import { RmqEventTransport } from "./rmqEventTransport.js";

export type CreateEventTransportInput = {
  transport: DeploymentTransport;
  workerRole: WorkerRole;
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
  const { transport, workerRole, forceRmq = false } = input;
  assertTransportCompatible(workerRole, transport);
  const useRmq = forceRmq || transport.kind === "rmq" || workerRole !== "all";
  if (useRmq) return new RmqEventTransport(transport.rmq);
  return new InProcessEventTransport();
}

export function resolveTransportFromManifest(manifest: DeploymentManifest): DeploymentTransport {
  return manifest.transport;
}
