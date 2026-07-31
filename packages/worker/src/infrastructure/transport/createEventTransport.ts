import type { DataSource } from "typeorm";
import type { DeploymentManifest, DeploymentTransport } from "@radar/shared";
import { resolveRmqConsumerSuffix } from "@radar/shared";
import type { IEventTransport } from "@radar/shared";
import { createRmqEventTransport } from "@radar/transport-rmq";
import type { WorkerRole } from "../config/workerRole.js";
import { createPgTransportDedup } from "./pgTransportDedup.js";

export type CreateEventTransportInput = {
  transport: DeploymentTransport;
  workerRole: WorkerRole;
  /** PG dedup L2 для RMQ consumer. */
  dataSource?: DataSource;
  /** API всегда rmq для admin/control. */
  forceRmq?: boolean;
};

/** Fail-fast: worker всегда RMQ (in-process только для unit-тестов через force — запрещён). */
export function assertTransportCompatible(_role: WorkerRole, transport: DeploymentTransport): void {
  if (transport.kind === "in-process") {
    throw new Error("Worker requires transport.kind=rmq (in-process monolith removed)");
  }
}

export function createEventTransport(input: CreateEventTransportInput): IEventTransport {
  const { transport, workerRole, dataSource } = input;
  assertTransportCompatible(workerRole, transport);
  const pgDedup = transport.rmq.dedupTable && dataSource ? createPgTransportDedup(dataSource) : undefined;
  return createRmqEventTransport(
    transport.rmq,
    pgDedup,
    resolveRmqConsumerSuffix(workerRole),
    exitWorkerOnConnectionLoss,
  );
}

/** Завершает worker: восстановление соединения и подписок выполняет Docker supervisor. */
function exitWorkerOnConnectionLoss(error: Error): void {
  console.error("[rmq] connection lost; worker will restart", error);
  process.exit(1);
}

export function resolveTransportFromManifest(manifest: DeploymentManifest): DeploymentTransport {
  return manifest.transport;
}