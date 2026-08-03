import type { DataSource } from "typeorm";
import type {
  DeploymentManifest,
  DeploymentTransport,
  IEventTransport,
  ITransportMetricsRecorder,
} from "@radar/shared";
import { resolveRmqConsumerSuffix } from "@radar/shared";
import { createRmqEventTransport } from "@radar/transport-rmq";
import type { WorkerRole } from "../config/workerRole.js";
import { createPrometheusTransportMetricsRecorder } from "../metrics/prometheusTransportMetricsRecorder.js";
import { getWorkerPrometheusMetrics } from "../metrics/workerPrometheusMetrics.js";
import { createPgTransportDedup } from "./pgTransportDedup.js";

export type CreateEventTransportInput = {
  transport: DeploymentTransport;
  workerRole: WorkerRole;
  /** PG dedup L2 для RMQ consumer. */
  dataSource?: DataSource;
  /** API всегда rmq для admin/control. */
  forceRmq?: boolean;
  /** Override метрик (тесты); по умолчанию — Prometheus на worker registry. */
  metrics?: ITransportMetricsRecorder;
};

/** Fail-fast: worker всегда RMQ (in-process monolith removed). */
export function assertTransportCompatible(_role: WorkerRole, transport: DeploymentTransport): void {
  if (transport.kind === "in-process") {
    throw new Error("Worker requires transport.kind=rmq (in-process monolith removed)");
  }
}

export function createEventTransport(input: CreateEventTransportInput): IEventTransport {
  const { transport, workerRole, dataSource, metrics } = input;
  assertTransportCompatible(workerRole, transport);
  const pgDedup = transport.rmq.dedupTable && dataSource ? createPgTransportDedup(dataSource) : undefined;
  const transportMetrics =
    metrics ?? createPrometheusTransportMetricsRecorder(getWorkerPrometheusMetrics().registry);
  return createRmqEventTransport(
    transport.rmq,
    pgDedup,
    resolveRmqConsumerSuffix(workerRole),
    exitWorkerOnConnectionLoss,
    transportMetrics,
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
