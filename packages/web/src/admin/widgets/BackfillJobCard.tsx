import type { BackfillJobListItem } from "@radar/shared";
import { BackfillJobMetrics } from "./BackfillJobMetrics";

type Props = {
  job: BackfillJobListItem;
  runnableJobCount?: number;
  onCancel?: (id: string) => void;
};

/** Карточка job в гриде мониторинга backfill. */
export function BackfillJobCard({ job, runnableJobCount, onCancel }: Props) {
  return (
    <div
      className="ds-panel"
      style={{
        padding: 12,
        minWidth: 0,
        border: "1px solid var(--border-subtle)",
        borderRadius: 4,
        background: "var(--surface-raised)",
      }}
    >
      <BackfillJobMetrics
        job={job}
        runnableJobCount={runnableJobCount}
        onCancel={onCancel}
      />
    </div>
  );
}
