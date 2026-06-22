import { useEffect, useRef, useState } from "react";
import type { BackfillJobListItem, BackfillRoundRobinSlice, BackfillStrategy } from "@radar/shared";
import { computeBackfillPercentApprox, mergeBackfillPercentMonotonic } from "@radar/shared";
import { Button, StatTile } from "../../shared/ds";
import { formatAge } from "../../shared/state/derivations";
import { formatDateTime } from "../format";

/** Пороги пульса демона (синхрон с RADAR_BACKFILL_HEARTBEAT_MS ≈ 15с). */
const PULSE_EXPECT_MS = 15_000;
const PULSE_STALE_MS = PULSE_EXPECT_MS * 3;
const PULSE_DEAD_MS = PULSE_EXPECT_MS * 6;

function readPreflight(params: Record<string, unknown>): {
  minPostedAt: string;
  maxPostedAt: string;
} | null {
  const raw = params.preflight;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.minPostedAt !== "string" || typeof p.maxPostedAt !== "string") return null;
  return { minPostedAt: p.minPostedAt, maxPostedAt: p.maxPostedAt };
}

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--status-warn)",
  completed: "var(--status-ok)",
  failed: "var(--status-error)",
  canceled: "var(--text-muted)",
};

const STRATEGY_LABEL: Record<BackfillStrategy, string> = {
  full_history: "Вся история",
  by_date_range: "По датам",
  by_external_id_range: "По id",
  all: "Вся история",
};

type DaemonPulse = {
  ageMs: number;
  ok: boolean;
  stale: boolean;
  dead: boolean;
};

function readDaemonPulse(iso: string, live: boolean): DaemonPulse {
  const ageMs = live ? Date.now() - new Date(iso).getTime() : 0;
  return {
    ageMs,
    ok: !live || ageMs <= PULSE_STALE_MS,
    stale: live && ageMs > PULSE_STALE_MS && ageMs <= PULSE_DEAD_MS,
    dead: live && ageMs > PULSE_DEAD_MS,
  };
}

/** Индикатор демона: зелёный — живой/батч, жёлтый — ждёт slice, красный — молчит. */
function RoundRobinIndicator({
  slice,
  runnableCount,
  pulse,
}: {
  slice: BackfillRoundRobinSlice | null;
  runnableCount: number;
  pulse: DaemonPulse;
}) {
  if (!slice) return null;

  const solo = runnableCount <= 1;
  const color = pulse.dead
    ? "var(--status-error)"
    : slice === "active" || (solo && pulse.ok)
      ? "var(--status-ok)"
      : pulse.stale
        ? "var(--status-warn)"
        : "var(--status-warn)";

  const title = pulse.dead
    ? "Демон не пульсит — проверьте worker"
    : slice === "active"
      ? "Сейчас качает батч Telegram"
      : solo
        ? "Единственная задача — демон в round-robin"
        : "Ждёт своего slice (другой канал в работе)";

  return (
    <span
      className="ds-stat-tile__dot"
      style={{ background: color, flexShrink: 0 }}
      title={title}
      aria-label={title}
    />
  );
}

/** Скорость роста «обработано» за последнее окно (msg/мин). */
function useProcessedThroughput(processed: number, live: boolean): string | null {
  const sampleRef = useRef({ processed, at: Date.now() });
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setLabel(null);
      return;
    }

    const now = Date.now();
    const prev = sampleRef.current;
    const delta = processed - prev.processed;
    const elapsedSec = (now - prev.at) / 1000;

    if (delta > 0 && elapsedSec >= 4) {
      const perMin = Math.round((delta / elapsedSec) * 60);
      setLabel(`~${perMin} msg/мин`);
      sampleRef.current = { processed, at: now };
      return;
    }

    if (elapsedSec >= 45) {
      sampleRef.current = { processed, at: now };
      if (delta === 0) setLabel(null);
    }
  }, [processed, live]);

  return label;
}

/** Живой статус демона + относительный пульс (тик 1с). */
function LiveDaemonStatus({
  iso,
  live,
  slice,
  runnableCount,
  throughput,
}: {
  iso: string;
  live: boolean;
  slice: BackfillRoundRobinSlice | null;
  runnableCount: number;
  throughput: string | null;
}) {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => bump((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live, iso]);

  if (!live) {
    return (
      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
        завершено {formatAge(iso)}
      </span>
    );
  }

  const pulse = readDaemonPulse(iso, live);
  const solo = runnableCount <= 1;
  const color = pulse.dead
    ? "var(--status-error)"
    : pulse.stale
      ? "var(--status-warn)"
      : slice === "active" || solo
        ? "var(--status-ok)"
        : "var(--text-muted)";

  let statusLabel: string;
  if (pulse.dead) {
    statusLabel = "демон молчит";
  } else if (slice === "active") {
    statusLabel = "батч";
  } else if (solo) {
    statusLabel = "демон жив";
  } else {
    statusLabel = "след. slice";
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 9, color }}>
      <span title={`Пульс job.updated_at: ${formatDateTime(iso)}`}>
        {statusLabel} · пульс {formatAge(iso)}
        {pulse.dead ? " (>90с)" : pulse.stale ? " · редкий" : null}
      </span>
      {throughput && (
        <span style={{ color: "var(--status-ok)" }} title="Прирост inserted+duplicates">
          {throughput}
        </span>
      )}
      {slice === "waiting" && !solo && pulse.ok && (
        <span style={{ color: "var(--text-muted)" }} title="Round-robin: другой канал в батче">
          RR очередь
        </span>
      )}
    </div>
  );
}

function formatShare(part: number, total: number): string {
  if (total <= 0) return "";
  const pct = Math.round((part / total) * 100);
  return ` (${pct}%)`;
}

function formatIdCheckpoint(
  checkpoint: string | null,
  minId: string | null,
  maxId: string | null,
): string | null {
  if (!minId || !maxId) return null;
  if (checkpoint) {
    return `id ${checkpoint} → ${minId} · из ${maxId}`;
  }
  return `id ${maxId} → ${minId}`;
}

function strategySummary(job: BackfillJobListItem): string {
  const p = job.params;
  if (job.strategy === "by_date_range") {
    const from = typeof p.fromPostedAt === "string" ? formatDateTime(p.fromPostedAt) : "…";
    const to = typeof p.toPostedAt === "string" ? formatDateTime(p.toPostedAt) : "…";
    return `${from} → ${to}`;
  }
  if (job.strategy === "by_external_id_range") {
    const from = typeof p.fromExternalId === "string" ? p.fromExternalId : "…";
    const to = typeof p.toExternalId === "string" ? p.toExternalId : "…";
    return `id ${from} → ${to}`;
  }
  return STRATEGY_LABEL[job.strategy] ?? job.strategy;
}

/** % по checkpoint и bounds канала (независимо для каждой job). */
function resolveJobPercent(job: BackfillJobListItem): number | null {
  const fromCheckpoint = computeBackfillPercentApprox(
    job.strategy,
    job.params,
    job.progress.checkpointOffsetId,
  );
  return mergeBackfillPercentMonotonic(
    job.progress.percentApprox,
    fromCheckpoint,
  );
}

type Props = {
  job: BackfillJobListItem;
  runnableJobCount?: number;
  onCancel?: (id: string) => void;
};

/** Метрики ingest-job: ~% по id min/max + checkpoint канала. */
export function BackfillJobMetrics({ job, runnableJobCount = 1, onCancel }: Props) {
  const preflight = readPreflight(job.params);
  const { progress } = job;
  const processed = progress.inserted + progress.duplicates;
  const cancelable = job.status === "pending" || job.status === "running";
  const percent = resolveJobPercent(job);
  const hasCheckpoint = progress.checkpointOffsetId != null;
  const isLive = job.status === "pending" || job.status === "running";
  const showBar = isLive || percent != null || hasCheckpoint;
  const throughput = useProcessedThroughput(processed, isLive);
  const pulse = readDaemonPulse(job.updatedAt, isLive);

  const percentLabel =
    percent != null
      ? `~${percent}%`
      : job.status === "pending"
        ? preflight
          ? "ожидает демон…"
          : "ожидает preflight…"
        : hasCheckpoint
          ? pulse.dead
            ? "пауза (демон?)"
            : "докачка…"
          : "—";

  const idProgressLabel = formatIdCheckpoint(
    progress.checkpointOffsetId,
    progress.boundsMinId,
    progress.boundsMaxId,
  );

  const dupShare = formatShare(progress.duplicates, processed);
  const newShare = formatShare(progress.inserted, processed);

  const handleCancel = (): void => {
    if (!onCancel) return;
    if (job.status === "running") {
      if (!window.confirm("Прервать докачку Telegram? Checkpoint сохранится в этой задаче.")) {
        return;
      }
    }
    onCancel(job.id);
  };

  const channelLabel = job.channelKey ?? "—";
  const showSlice = job.roundRobinSlice != null;
  const headerColumns = showSlice
    ? cancelable && onCancel
      ? "auto minmax(0, 1fr) auto auto"
      : "auto minmax(0, 1fr) auto"
    : cancelable && onCancel
      ? "minmax(0, 1fr) auto auto"
      : "minmax(0, 1fr) auto";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header
        style={{
          display: "grid",
          gridTemplateColumns: headerColumns,
          alignItems: "center",
          gap: "4px 8px",
        }}
      >
        {showSlice && (
          <RoundRobinIndicator
            slice={job.roundRobinSlice}
            runnableCount={runnableJobCount}
            pulse={pulse}
          />
        )}
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={channelLabel}
        >
          {channelLabel}
        </span>
        <span
          style={{
            color: STATUS_COLOR[job.status] ?? "inherit",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {job.status}
        </span>
        {cancelable && onCancel && (
          <Button variant="danger" onClick={handleCancel} title="Прервать докачку">
            Отменить
          </Button>
        )}
      </header>

      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {job.strategy === "full_history" || job.strategy === "all"
          ? STRATEGY_LABEL[job.strategy] ?? job.strategy
          : `${STRATEGY_LABEL[job.strategy] ?? job.strategy} · ${strategySummary(job)}`}
      </div>

      {showBar && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: "var(--text-muted)",
              marginBottom: 2,
              gap: 8,
            }}
          >
            <span title="Примерный % по id-диапазону канала (не число сообщений)">
              {percentLabel}
            </span>
            {idProgressLabel && (
              <span title="Текущий checkpoint / цель (от новых к старым)">{idProgressLabel}</span>
            )}
          </div>
          <div className="ds-progress" style={{ minHeight: 6 }}>
            <div
              className="ds-progress__fill"
              style={{
                width: `${percent ?? 0}%`,
                minWidth: percent != null && percent > 0 ? 2 : 0,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
        }}
      >
        <StatTile
          label={`новые${newShare}`}
          value={progress.inserted}
          dotColor="var(--status-ok)"
        />
        <StatTile
          label={`дубли${dupShare}`}
          value={progress.duplicates}
          dotColor={isLive && throughput ? "var(--status-ok)" : "var(--text-muted)"}
        />
        <StatTile label="обработано" value={processed} />
      </div>

      {progress.parsed > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
          parse на insert: {progress.parsed}
        </div>
      )}

      {preflight && (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }} title="Диапазон дат канала в Telegram">
          TG {formatDateTime(preflight.minPostedAt)} — {formatDateTime(preflight.maxPostedAt)}
        </div>
      )}

      {job.status === "completed" && (
        <p style={{ fontSize: 10, color: "var(--status-ok)", margin: 0 }}>
          Raw загружен. Parse — см. Обогащение → Фазы и статистику канала.
        </p>
      )}

      <LiveDaemonStatus
        iso={job.updatedAt}
        live={isLive}
        slice={job.roundRobinSlice}
        runnableCount={runnableJobCount}
        throughput={throughput}
      />
    </div>
  );
}
