import type { DataSource } from "typeorm";
import type {
  GeoCatalogResetStepStats,
  IGeoCatalogResetReporter,
} from "./geo-catalog.reporter.port";

export type GeoCatalogResetStats = {
  regionAdjacencyDeleted: number;
  regionStateHistoryDeleted: number;
  regionStateActiveDeleted: number;
  placeGeoLinksDeleted: number;
  geoFeaturesDeleted: number;
  geoSyncLogDeleted: number;
  aliasesDeleted: number;
  eventLocationsUnlinked: number;
  placesDeleted: number;
  geoDatasetFilesDeleted: number;
  regionsDeleted: number;
};

type ResetStep = {
  id: string;
  label: string;
  run: () => Promise<number>;
};

async function deleteReturningCount(
  dataSource: DataSource,
  sql: string,
): Promise<number> {
  const rows = (await dataSource.query(sql)) as unknown[];
  return rows.length;
}

/** DELETE для таблицы, которой может не быть до migration:run. */
async function deleteOptional(
  dataSource: DataSource,
  sql: string,
): Promise<number> {
  try {
    return await deleteReturningCount(dataSource, sql);
  } catch {
    return 0;
  }
}

/**
 * Полный сброс гео-справочника в БД перед geo:catalog:import.
 * Удаляет places, aliases, geo_feature, regions и связанные строки.
 *
 * Операционный слой (raw_messages, parsed_events) не трогает —
 * только обнуляет place_id там, где FK RESTRICT.
 */
export class GeoCatalogResetService {
  constructor(private readonly dataSource: DataSource) {}

  /** Dry-run: что будет удалено (без SQL). */
  describe(): string[] {
    const steps = this.buildSteps();
    return steps.map(
      (step, index) => `[${index + 1}/${steps.length}] ${step.label}`,
    );
  }

  async run(reporter?: IGeoCatalogResetReporter): Promise<GeoCatalogResetStats> {
    const steps = this.buildSteps();
    const stepStats: GeoCatalogResetStepStats[] = [];
    const totals: Partial<GeoCatalogResetStats> = {};

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      reporter?.stepBegin(step.label, index + 1, steps.length);

      const started = Date.now();
      const rows = await step.run();
      const durationMs = Date.now() - started;

      const stat: GeoCatalogResetStepStats = {
        step: step.id,
        rows,
        durationMs,
      };
      stepStats.push(stat);
      reporter?.stepDone(stat);

      this.assignTotal(totals, step.id, rows);
    }

    const stats = this.toStats(totals);
    reporter?.finish({ ...stats }, stepStats);
    return stats;
  }

  private buildSteps(): ResetStep[] {
    return [
      {
        id: "unlink_fk",
        label: "обнуление FK (canonical_place_id, geometry_artifact_key, geo_feature_id)",
        run: async () => {
          let rows = 0;
          rows += await deleteOptional(
            this.dataSource,
            `UPDATE regions SET canonical_place_id = NULL
             WHERE canonical_place_id IS NOT NULL RETURNING id`,
          );
          rows += await deleteOptional(
            this.dataSource,
            `UPDATE regions SET geometry_artifact_key = NULL
             WHERE geometry_artifact_key IS NOT NULL RETURNING id`,
          );
          rows += await deleteOptional(
            this.dataSource,
            `UPDATE places SET geo_feature_id = NULL
             WHERE geo_feature_id IS NOT NULL RETURNING id`,
          );
          return rows;
        },
      },
      {
        id: "region_adjacency",
        label: "region_adjacency",
        run: () =>
          deleteOptional(
            this.dataSource,
            `DELETE FROM region_adjacency RETURNING region_id`,
          ),
      },
      {
        id: "place_geo_link",
        label: "place_geo_link",
        run: () =>
          deleteOptional(
            this.dataSource,
            `DELETE FROM place_geo_link RETURNING id`,
          ),
      },
      {
        id: "geo_feature",
        label: "geo_feature",
        run: () =>
          deleteOptional(
            this.dataSource,
            `DELETE FROM geo_feature RETURNING id`,
          ),
      },
      {
        id: "geo_sync_log",
        label: "geo_sync_log",
        run: () =>
          deleteOptional(
            this.dataSource,
            `DELETE FROM geo_sync_log RETURNING id`,
          ),
      },
      {
        id: "place_aliases",
        label: "place_aliases",
        run: () =>
          deleteReturningCount(
            this.dataSource,
            `DELETE FROM place_aliases RETURNING id`,
          ),
      },
      {
        id: "event_locations",
        label: "event_locations.place_id → NULL",
        run: () =>
          deleteOptional(
            this.dataSource,
            `UPDATE event_locations SET place_id = NULL
             WHERE place_id IS NOT NULL RETURNING id`,
          ),
      },
      {
        id: "places",
        label: "places (дочерние → все)",
        run: async () => {
          const children = await deleteReturningCount(
            this.dataSource,
            `DELETE FROM places WHERE parent_place_id IS NOT NULL RETURNING id`,
          );
          const roots = await deleteReturningCount(
            this.dataSource,
            `DELETE FROM places RETURNING id`,
          );
          return children + roots;
        },
      },
      {
        id: "geo_dataset_file",
        label: "geo_dataset_file",
        run: () =>
          deleteOptional(
            this.dataSource,
            `DELETE FROM geo_dataset_file RETURNING artifact_key`,
          ),
      },
      {
        id: "regions",
        label: "regions",
        run: () =>
          deleteReturningCount(
            this.dataSource,
            `DELETE FROM regions RETURNING id`,
          ),
      },
    ];
  }

  private assignTotal(
    totals: Partial<GeoCatalogResetStats>,
    stepId: string,
    rows: number,
  ): void {
    const map: Record<string, keyof GeoCatalogResetStats> = {
      region_adjacency: "regionAdjacencyDeleted",
      region_state_history: "regionStateHistoryDeleted",
      region_state_active: "regionStateActiveDeleted",
      place_geo_link: "placeGeoLinksDeleted",
      geo_feature: "geoFeaturesDeleted",
      geo_sync_log: "geoSyncLogDeleted",
      place_aliases: "aliasesDeleted",
      event_locations: "eventLocationsUnlinked",
      places: "placesDeleted",
      geo_dataset_file: "geoDatasetFilesDeleted",
      regions: "regionsDeleted",
    };
    const key = map[stepId];
    if (key) {
      totals[key] = rows;
    }
  }

  private toStats(totals: Partial<GeoCatalogResetStats>): GeoCatalogResetStats {
    return {
      regionAdjacencyDeleted: totals.regionAdjacencyDeleted ?? 0,
      regionStateHistoryDeleted: totals.regionStateHistoryDeleted ?? 0,
      regionStateActiveDeleted: totals.regionStateActiveDeleted ?? 0,
      placeGeoLinksDeleted: totals.placeGeoLinksDeleted ?? 0,
      geoFeaturesDeleted: totals.geoFeaturesDeleted ?? 0,
      geoSyncLogDeleted: totals.geoSyncLogDeleted ?? 0,
      aliasesDeleted: totals.aliasesDeleted ?? 0,
      eventLocationsUnlinked: totals.eventLocationsUnlinked ?? 0,
      placesDeleted: totals.placesDeleted ?? 0,
      geoDatasetFilesDeleted: totals.geoDatasetFilesDeleted ?? 0,
      regionsDeleted: totals.regionsDeleted ?? 0,
    };
  }
}
