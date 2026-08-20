/**
 * SSOT persisted UI-настроек в localStorage.
 * Хранит только UI-предпочтения и не содержит runtime-состояния таймлайна.
 */
const UI_PREFERENCES_STORAGE_KEY = "radar.ui.preferences.v1";

type PersistedUiPreferences = {
  widgetVisibility?: Record<string, boolean>;
  panelCollapsed?: Record<string, boolean>;
  /** Активные табы по ключу области (например admin.activeTab). */
  activeTabs?: Record<string, string>;
  mapLayers?: Record<string, boolean>;
  heatmap?: PersistedHeatmapPreferences;
};

export type PersistedHeatmapPreferences = {
  period?: string;
  filterMode?: "all" | "custom";
  filterTypes?: string[];
};

const EMPTY_PREFERENCES: PersistedUiPreferences = {
  widgetVisibility: {},
  panelCollapsed: {},
  activeTabs: {},
  mapLayers: {},
  heatmap: {
    period: undefined,
    filterMode: undefined,
    filterTypes: [],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPersistedUiPreferences(): PersistedUiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return EMPTY_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY_PREFERENCES;
    return parsed as PersistedUiPreferences;
  } catch {
    return EMPTY_PREFERENCES;
  }
}

function writePersistedUiPreferences(next: PersistedUiPreferences): void {
  try {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function patchPersistedUiPreferences(
  patch: Partial<PersistedUiPreferences>,
): PersistedUiPreferences {
  const current = readPersistedUiPreferences();
  const next: PersistedUiPreferences = {
    ...current,
    ...patch,
    widgetVisibility: {
      ...(current.widgetVisibility ?? {}),
      ...(patch.widgetVisibility ?? {}),
    },
    panelCollapsed: {
      ...(current.panelCollapsed ?? {}),
      ...(patch.panelCollapsed ?? {}),
    },
    activeTabs: {
      ...(current.activeTabs ?? {}),
      ...(patch.activeTabs ?? {}),
    },
    mapLayers: {
      ...(current.mapLayers ?? {}),
      ...(patch.mapLayers ?? {}),
    },
    heatmap: {
      ...(current.heatmap ?? {}),
      ...(patch.heatmap ?? {}),
      filterTypes: patch.heatmap?.filterTypes ?? current.heatmap?.filterTypes ?? [],
    },
  };
  writePersistedUiPreferences(next);
  return next;
}

/** Возвращает видимость виджетов с fallback на defaults. */
export function readWidgetVisibility(
  defaults: Record<string, boolean>,
): Record<string, boolean> {
  const saved = readPersistedUiPreferences().widgetVisibility ?? {};
  const keys = Object.keys(defaults);
  const entries = keys.map((key) => [key, saved[key] ?? defaults[key]] as const);
  return Object.fromEntries(entries);
}

/** Пишет только переданные ключи видимости виджетов. */
export function writeWidgetVisibility(
  visibility: Record<string, boolean>,
): void {
  patchPersistedUiPreferences({ widgetVisibility: visibility });
}

/** Читает fold-состояние панели по стабильному ключу. */
export function readPanelCollapsed(
  key: string,
  fallback: boolean,
): boolean {
  const value = readPersistedUiPreferences().panelCollapsed?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Сохраняет fold-состояние панели по стабильному ключу. */
export function writePanelCollapsed(key: string, collapsed: boolean): void {
  patchPersistedUiPreferences({ panelCollapsed: { [key]: collapsed } });
}

/** Читает активный таб по ключу области (fallback, если нет/пустой). */
export function readActiveTab(key: string, fallback: string): string {
  const value = readPersistedUiPreferences().activeTabs?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Сохраняет активный таб по ключу области. */
export function writeActiveTab(key: string, id: string): void {
  patchPersistedUiPreferences({ activeTabs: { [key]: id } });
}

/** Возвращает map-layer toggle state с fallback на defaults. */
export function readMapLayers(
  defaults: Record<string, boolean>,
): Record<string, boolean> {
  const saved = readPersistedUiPreferences().mapLayers ?? {};
  const keys = Object.keys(defaults);
  const entries = keys.map((key) => [key, saved[key] ?? defaults[key]] as const);
  return Object.fromEntries(entries);
}

/** Пишет map-layer toggle state. */
export function writeMapLayers(layers: Record<string, boolean>): void {
  patchPersistedUiPreferences({ mapLayers: layers });
}

/** Читает сохранённые настройки heatmap. */
export function readHeatmapPreferences(): PersistedHeatmapPreferences {
  return readPersistedUiPreferences().heatmap ?? {};
}

/** Пишет настройки heatmap (period/filter mode/filter types). */
export function writeHeatmapPreferences(
  patch: PersistedHeatmapPreferences,
): void {
  patchPersistedUiPreferences({ heatmap: patch });
}
