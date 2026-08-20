import { Gauge, type Registry } from "prom-client";
import type { RuntimeObservabilitySnapshot } from "@radar/shared";

export type ObsSnapshotProvider = () => Promise<RuntimeObservabilitySnapshot>;

export type ObsPrometheusCollector = {
  /** Явная регистрация не нужна — gauges уже в registry. */
  readonly registered: true;
};

type ObsGauges = {
  hostLastSeen: Gauge<"host_id" | "role">;
  workloadUp: Gauge<"pipeline_key" | "host_id" | "status">;
  workloadLastTick: Gauge<"pipeline_key" | "host_id">;
  triggerEvents: Gauge<"pipeline_key" | "event_type" | "source">;
  materializeEvents: Gauge<"pipeline_key">;
};

/**
 * Read-only мост obs_* → Prometheus.
 * Значения читаются just-in-time при scrape (Gauge.collect), без фонового polling.
 */
export function createObsPrometheusCollector(
  registry: Registry,
  snapshotProvider: ObsSnapshotProvider,
): ObsPrometheusCollector {
  let collectInFlight: Promise<void> | null = null;
  const gauges = {} as ObsGauges;

  const refresh = async (): Promise<void> => {
    if (collectInFlight) {
      await collectInFlight;
      return;
    }
    collectInFlight = refreshOnce(snapshotProvider, gauges).finally(() => {
      collectInFlight = null;
    });
    await collectInFlight;
  };

  gauges.hostLastSeen = new Gauge({
    name: "radar_obs_host_last_seen_seconds",
    help: "Возраст host heartbeat (секунды с lastSeenAt)",
    labelNames: ["host_id", "role"] as const,
    registers: [registry],
    async collect() {
      await refresh();
    },
  });

  gauges.workloadUp = new Gauge({
    name: "radar_obs_workload_up",
    help: "1 для текущего статуса workload (остальные комбинации сбрасываются на scrape)",
    labelNames: ["pipeline_key", "host_id", "status"] as const,
    registers: [registry],
    async collect() {
      await refresh();
    },
  });

  gauges.workloadLastTick = new Gauge({
    name: "radar_obs_workload_last_tick_seconds",
    help: "Возраст последнего tick workload (секунды); без lastTickAt серия не выставляется",
    labelNames: ["pipeline_key", "host_id"] as const,
    registers: [registry],
    async collect() {
      await refresh();
    },
  });

  gauges.triggerEvents = new Gauge({
    name: "radar_obs_trigger_events",
    help: "Накопленный счётчик trigger из obs_trigger_counters",
    labelNames: ["pipeline_key", "event_type", "source"] as const,
    registers: [registry],
    async collect() {
      await refresh();
    },
  });

  gauges.materializeEvents = new Gauge({
    name: "radar_obs_materialize_events",
    help: "Накопленный счётчик materialize из obs_materialize_counters",
    labelNames: ["pipeline_key"] as const,
    registers: [registry],
    async collect() {
      await refresh();
    },
  });

  return { registered: true };
}

async function refreshOnce(
  snapshotProvider: ObsSnapshotProvider,
  gauges: ObsGauges,
): Promise<void> {
  try {
    const snap = await snapshotProvider();
    const nowMs = Date.now();

    gauges.hostLastSeen.reset();
    gauges.workloadUp.reset();
    gauges.workloadLastTick.reset();
    gauges.triggerEvents.reset();
    gauges.materializeEvents.reset();

    for (const host of snap.hosts) {
      const ageSec = ageSeconds(nowMs, host.lastSeenAt);
      if (ageSec == null) continue;
      gauges.hostLastSeen.set({ host_id: host.hostId, role: host.role }, ageSec);
    }

    for (const wl of snap.workloads) {
      gauges.workloadUp.set(
        {
          pipeline_key: wl.pipelineKey,
          host_id: wl.hostId,
          status: wl.status,
        },
        1,
      );
      const tickAge = ageSeconds(nowMs, wl.lastTickAt);
      if (tickAge != null) {
        gauges.workloadLastTick.set(
          { pipeline_key: wl.pipelineKey, host_id: wl.hostId },
          tickAge,
        );
      }
    }

    for (const row of snap.triggerCounters) {
      gauges.triggerEvents.set(
        {
          pipeline_key: row.pipelineKey,
          event_type: row.eventType,
          source: row.source,
        },
        row.count,
      );
    }

    for (const row of snap.materializeCounters) {
      gauges.materializeEvents.set({ pipeline_key: row.pipelineKey }, row.count);
    }
  } catch (err) {
    console.warn("[obs-prom] snapshot collect failed:", err);
  }
}

function ageSeconds(nowMs: number, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (nowMs - ts) / 1000);
}
