/**
 * Строка трека в списке (не путать с TimelineTrack — слайдером таймлайна).
 */
import type { TrajectoryTrack } from "@radar/shared";
import { formatTimeShort } from "../../shared/format/dateTime";

const PROFILE_LABELS: Record<string, string> = {
  uav: "БПЛА",
  rocket: "Ракета",
  balloon: "МВШ",
  unknown: "Неизв.",
};

const STATUS_COLORS: Record<string, string> = {
  active: "#ef4444",
  stale: "#f59e0b",
  closed: "#6b7280",
};

type Props = {
  track: TrajectoryTrack;
  selected: boolean;
  onClick: () => void;
};

/** Полоса одного трека в списке. */
export function TrajectoryTrackRow({ track, selected, onClick }: Props) {
  const color = STATUS_COLORS[track.status] ?? "#6b7280";
  const label = PROFILE_LABELS[track.threatProfile] ?? track.threatProfile;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        background: selected ? "rgba(255,255,255,0.12)" : "transparent",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "#e5e7eb", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label} · {track.nodeCount} нод · {formatTimeShort(track.firstAt)}
      </span>
      <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>
        {Math.round(track.totalDistanceM / 1000)} км
      </span>
    </button>
  );
}
