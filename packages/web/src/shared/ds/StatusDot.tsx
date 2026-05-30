type StatusKind = "ok" | "warn" | "error" | "neutral";

type StatusDotProps = {
  kind: StatusKind;
  label: string;
  pulse?: boolean;
  /** Расширенная подсказка (если label сокращён). */
  tip?: string;
};

const kindColor: Record<StatusKind, string> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  neutral: "var(--text-muted)",
};

/** Цветная точка + подпись статуса. */
export function StatusDot({ kind, label, pulse = false, tip }: StatusDotProps) {
  return (
    <span className="ds-status-dot" title={tip ?? label}>
      <span
        className={`ds-status-dot__circle${pulse ? " ds-status-dot__circle--pulse" : ""}`}
        style={{ background: kindColor[kind] }}
      />
      {label}
    </span>
  );
}
