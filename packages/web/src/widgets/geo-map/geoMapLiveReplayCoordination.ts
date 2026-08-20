/**
 * Координация режима карты с её runtime-представлением.
 *
 * Live/replay fold загружает `mapLiveReplayEffects`; здесь только реакция
 * runtime на общий store: тема и выбор пользователя.
 */
import type { Subject, Subscription } from "rxjs";
import { takeUntil } from "rxjs";
import { selectedRegion$ } from "../../shared/state/selectionStore";
import { selectedTrackId$ } from "../../shared/state/trackStore";
import { theme$, type ThemeMode } from "../../shared/state/themeStore";

export type GeoMapLiveReplayCoordinationDependencies = {
  subscriptions: Subscription;
  destroy$: Subject<void>;
  initialTheme: ThemeMode;
  onThemeChange(theme: ThemeMode): void;
  onRegionSelection(regionCode: string | null): void;
  onTrackSelection(trackId: string | null): void;
};

/** Связывает живой/replay store с уже созданным map runtime. */
export function wireGeoMapLiveReplayCoordination({
  subscriptions,
  destroy$,
  initialTheme,
  onThemeChange,
  onRegionSelection,
  onTrackSelection,
}: GeoMapLiveReplayCoordinationDependencies): void {
  let appliedTheme = initialTheme;

  subscriptions.add(
    theme$.pipe(takeUntil(destroy$)).subscribe((theme) => {
      if (theme === appliedTheme) return;
      appliedTheme = theme;
      onThemeChange(theme);
    }),
  );

  subscriptions.add(
    selectedRegion$.pipe(takeUntil(destroy$)).subscribe(onRegionSelection),
  );

  subscriptions.add(
    selectedTrackId$.pipe(takeUntil(destroy$)).subscribe(onTrackSelection),
  );
}
