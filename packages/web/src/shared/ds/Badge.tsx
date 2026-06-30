import type { StateLevel } from "@radar/shared";
import { LEVEL_COLORS, LEVEL_LABELS } from "../config/mapConfig.service";

type BadgeProps = {
  level?: StateLevel;
  label?: string;
  variant?: "default" | "ok" | "warn" | "danger";
  children?: React.ReactNode;
};

/** Бейдж уровня состояния с цветом из DS-конфига. */
export function Badge({ level, label, variant, children }: BadgeProps) {
  if (variant) {
     return (
      <span className={`ds-badge ds-badge--${variant}`}>
        {children || label}
      </span>
     );
  }

  return (
    <span className="ds-badge" style={{ background: level ? LEVEL_COLORS[level] : undefined }}>
      {children || label || (level ? LEVEL_LABELS[level] : "")}
    </span>
  );
}
