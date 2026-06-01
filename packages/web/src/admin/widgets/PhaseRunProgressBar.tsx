import type { PhaseRunStats } from "@radar/shared";

/** Доля выполнения drain по stats phase_run (0–100) или null, если данных ещё нет. */
export function phaseRunProgressPercent(stats: PhaseRunStats): number | null {
  const pending = stats.pendingRemaining;
  const total = stats.totalKnown;

  if (total != null && total > 0 && pending != null) {
    const done = Math.max(0, total - pending);
    return Math.min(100, Math.round((done / total) * 100));
  }

  const processed = stats.processed > 0 ? stats.processed : stats.ok + stats.failed;
  if (pending != null && processed + pending > 0) {
    return Math.min(100, Math.round((processed / (processed + pending)) * 100));
  }

  return null;
}

type PhaseRunProgressBarProps = {
  stats: PhaseRunStats;
  title?: string;
};

/** Тонкий прогресс drain run (ok/processed vs pendingRemaining). */
export function PhaseRunProgressBar({ stats, title }: PhaseRunProgressBarProps) {
  const percent = phaseRunProgressPercent(stats);
  const width = percent ?? 0;
  const label =
    title ??
    (percent != null
      ? `${percent}% · ok ${stats.ok} · pending ${stats.pendingRemaining ?? "?"}`
      : `ok ${stats.ok} · pending ${stats.pendingRemaining ?? "?"}`);

  return (
    <div
      className="ds-progress ds-progress--thin"
      title={label}
      style={{ flex: "1 1 72px", minWidth: 48, maxWidth: 140 }}
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      role="progressbar"
    >
      <div className="ds-progress__fill" style={{ width: `${width}%` }} />
    </div>
  );
}
