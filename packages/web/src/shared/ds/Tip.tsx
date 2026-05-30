import type { CSSProperties, ReactNode } from "react";

type TipProps = {
  /** Полный текст подсказки при наведении. */
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

/**
 * Подсказка при наведении (native title): не ломает layout, работает в scroll-контейнерах.
 */
export function Tip({ label, children, className, style }: TipProps) {
  const text = label.trim();
  if (!text) return <>{children}</>;

  const cls = className ? `ds-tip ${className}` : "ds-tip";
  return (
    <span className={cls} title={text} style={style}>
      {children}
    </span>
  );
}
