import type { CSSProperties } from "react";
import { Tip } from "./Tip";

/** Сжимает пробелы для сравнения длины preview и оригинала. */
export function flattenText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Однострочный preview с многоточием. */
export function previewText(text: string, max: number): string {
  const flat = flattenText(text);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

type EllipsisTextProps = {
  text: string;
  maxChars?: number;
  className?: string;
  tip?: string;
  style?: CSSProperties;
};

/**
 * Обрезанный текст с полной версией при наведении.
 * Без maxChars — CSS ellipsis + подсказка с полным текстом.
 */
export function EllipsisText({
  text,
  maxChars,
  className = "ds-ellipsis",
  tip,
  style,
}: EllipsisTextProps) {
  const label = tip ?? text;
  const display = maxChars !== undefined ? previewText(text, maxChars) : text;
  const truncated =
    maxChars !== undefined ? flattenText(text).length > maxChars : true;

  const inner = (
    <span className={className} style={style}>
      {display}
    </span>
  );

  if (maxChars !== undefined && !truncated) return inner;

  return (
    <Tip label={label} className="ds-tip--hint">
      {inner}
    </Tip>
  );
}
