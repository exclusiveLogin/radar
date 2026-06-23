export type LiveBadgeKind = "ok" | "warn" | "error";

type LiveBadgeViewProps = {
  kind: LiveBadgeKind;
  label: string;
  title: string;
  pulse?: boolean;
};

/** Визуальный LIVE-бейдж: точка + подпись (карта, админка). */
export function LiveBadgeView({ kind, label, title, pulse = false }: LiveBadgeViewProps) {
  return (
    <span
      className={`ds-live-badge ds-live-badge--${kind}`}
      title={title}
      aria-label={title}
    >
      <span className={`ds-live-badge__dot${pulse ? " ds-live-badge__dot--pulse" : ""}`} />
      {label}
    </span>
  );
}
