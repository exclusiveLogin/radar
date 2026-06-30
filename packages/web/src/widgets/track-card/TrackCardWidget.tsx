/**
 * Карточка выбранного трека — показывает кинематические метаданные,
 * статус, профиль, узлы (origin/last).
 *
 * Данные: selectedTrackId$ + tracksList$ из trackStore.
 * Закрытие: selectTrack(null).
 */
import { useMemo } from "react";
import { Panel } from "../../shared/ds";
import { Badge } from "../../shared/ds";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import {
  selectedTrackId$,
  tracksList$,
  selectTrack,
} from "../../shared/state/trackStore";
import { formatDateTime } from "../../shared/format/dateTime";
import type { WidgetProps } from "../widgetProps";

const PROFILE_LABELS: Record<string, string> = {
  uav: "БПЛА",
  rocket: "Ракета",
  balloon: "МВШ",
  unknown: "Неизвестно",
};

const STATUS_VARIANTS: Record<string, "default" | "warn" | "danger" | "ok"> = {
  active: "danger",
  stale: "warn",
  closed: "default",
};

/** Форматирование дистанции в читаемый вид. */
function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m)} м`;
}

/** Форматирование скорости. */
function formatVelocity(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.round(ms * 3.6)} км/ч`;
}

/** Форматирование курса в стороны света. */
function formatBearing(deg: number | null): string {
  if (deg == null) return "—";
  const dirs = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
  const idx = Math.round(((deg % 360) + 360) / 45) % 8;
  return `${dirs[idx]} (${Math.round(deg)}°)`;
}

/** Длительность трека. */
function formatDuration(firstAt: string, lastAt: string): string {
  const ms = new Date(lastAt).getTime() - new Date(firstAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}ч ${m}мин` : `${m}мин`;
}

/**
 * Карточка выбранного трека.
 * Монтируется как overlay-виджет — отображается поверх карты при выборе.
 */
export function TrackCardWidget({ defaultCollapsed, panelPersistenceKey }: WidgetProps) {
  const selectedId = useBehaviorSubject(selectedTrackId$);
  const tracks = useBehaviorSubject(tracksList$);

  const track = useMemo(() => {
    if (!selectedId || !tracks) return null;
    return tracks.tracks.find(t => t.id === selectedId) ?? null;
  }, [selectedId, tracks]);

  if (!track) return null;

  const statusLabel = { active: "Активен", stale: "Устарел", closed: "Закрыт" }[track.status] ?? track.status;

  return (
    <Panel
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Трек · {PROFILE_LABELS[track.threatProfile] ?? track.threatProfile}</span>
          <Badge label={statusLabel} variant={STATUS_VARIANTS[track.status] ?? "default"} />
        </span>
      }
      actions={
        <button
          type="button"
          onClick={() => selectTrack(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}
          aria-label="Закрыть карточку трека"
        >
          ✕
        </button>
      }
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <tbody>
          <Row label="Начало" value={formatDateTime(track.firstAt)} />
          <Row label="Конец" value={formatDateTime(track.lastAt)} />
          <Row label="Длительность" value={formatDuration(track.firstAt, track.lastAt)} />
          <Row label="Нод" value={String(track.nodeCount)} />
          <Row label="Дальность" value={formatDistance(track.totalDistanceM)} />
          <Row label="Скорость" value={formatVelocity(track.velocityMs)} />
          <Row label="Курс" value={formatBearing(track.bearingDeg)} />
        </tbody>
      </table>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: "3px 8px 3px 0", color: "#9ca3af", whiteSpace: "nowrap" }}>{label}</td>
      <td style={{ padding: "3px 0", color: "#e5e7eb" }}>{value}</td>
    </tr>
  );
}
