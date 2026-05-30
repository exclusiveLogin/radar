type StatusKind = "ok" | "warn" | "error" | "neutral";

type StatusDotProps = {
  kind: StatusKind;
  label: string;
  pulse?: boolean;
};

const kindColor: Record<StatusKind, string> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  neutral: "var(--text-muted)",
};

/** Цветная точка + подпись статуса. */
export function StatusDot({ kind, label, pulse = false }: StatusDotProps) {
  return (
    <span className="ds-status-dot">
      <span
        className={`ds-status-dot__circle${pulse ? " ds-status-dot__circle--pulse" : ""}`}
        style={{ background: kindColor[kind] }}
      />
      {label}
    </span>
  );
}
