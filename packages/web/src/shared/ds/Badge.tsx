import type { StateLevel } from "@radar/shared";
import { LEVEL_COLORS, LEVEL_LABELS } from "../config/mapConfig.service";

type BadgeProps = {
  level: StateLevel;
  label?: string;
};

/** Бейдж уровня состояния с цветом из DS-конфига. */
export function Badge({ level, label }: BadgeProps) {
  return (
    <span className="ds-badge" style={{ background: LEVEL_COLORS[level] }}>
      {label ?? LEVEL_LABELS[level]}
    </span>
  );
}
