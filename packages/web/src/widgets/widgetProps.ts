/** Общие props виджетов, пробрасываемые из AppShell. */
export type WidgetProps = {
  /** Начальное состояние свёрнутости glass-панели. */
  defaultCollapsed?: boolean;
  /** Стабильный ключ персистентности fold-state для Panel. */
  panelPersistenceKey?: string;
};
