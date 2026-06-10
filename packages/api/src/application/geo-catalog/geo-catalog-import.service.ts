import type { DataSource } from "typeorm";
import { PlaceEntity } from "../../geo/entities";
import type { GeoProviderSnapshot } from "@radar/shared";
import { GeoSyncApplyService } from "../geo-sync/geo-sync-apply.service";
import { GeoSyncPlanService } from "../geo-sync/geo-sync-plan.service";
import { OsmRussiaGeoImporter } from "../geo-import/osm-russia-geo.importer";
import { TypeOrmDomainEventRepository } from "../../infrastructure/persistence/typeorm-domain-event.repository";
import { TypeOrmPlaceAliasRepository } from "../../infrastructure/persistence/typeorm-place-alias.repository";
import { TypeOrmPlaceRepository } from "../../infrastructure/persistence/typeorm-place.repository";
import { TypeOrmRegionRepository } from "../../infrastructure/persistence/typeorm-region.repository";
import { TypeOrmSyncAuditRepository } from "../../infrastructure/persistence/typeorm-sync-audit.repository";
import { FrontlineCatalogProvider } from "../../infrastructure/geo-catalog/frontline-catalog.provider";
import { RegionAdjacencyImporter } from "../../infrastructure/geo-catalog/region-adjacency.importer";
import { StaticGeoProvider } from "../../infrastructure/geo-catalog/static-geo.provider";
import { TabularCatalogProvider } from "../../infrastructure/geo-catalog/tabular-catalog.provider";
import type {
  GeoCatalogStepStats,
  IGeoCatalogImportReporter,
} from "./geo-catalog.reporter.port";
import type { IGeoSyncPersistReporter } from "../geo-sync/geo-sync.reporter.port";

export type GeoCatalogImportMode = "import" | "plan";

export type GeoCatalogImportResult = {
  mode: GeoCatalogImportMode;
  steps: GeoCatalogStepStats[];
};

type CatalogImportDeps = {
  dataSource: DataSource;
  reporter?: IGeoCatalogImportReporter;
  persist?: IGeoSyncPersistReporter;
};

const STEP_LABELS = ["tabular", "frontline", "osm_geometry", "adjacency"] as const;

/**
 * Оркестратор geo:catalog:import — 4 шага в фиксированном порядке.
 * Hard rule: словари (1–2) до геометрии (3).
 */
export class GeoCatalogImportService {
  constructor(private readonly deps: CatalogImportDeps) {}

  async run(mode: GeoCatalogImportMode): Promise<GeoCatalogImportResult> {
    const steps: GeoCatalogStepStats[] = [];
    const regions = new TypeOrmRegionRepository(this.deps.dataSource);
    const places = new TypeOrmPlaceRepository(this.deps.dataSource);
    const aliases = new TypeOrmPlaceAliasRepository(this.deps.dataSource);
    const audit = new TypeOrmSyncAuditRepository(this.deps.dataSource);
    const events = new TypeOrmDomainEventRepository(this.deps.dataSource);

    // [1/4] tabular
    steps.push(
      await this.runCatalogStep({
        stepIndex: 0,
        label: STEP_LABELS[0],
        mode,
        snapshot: await new TabularCatalogProvider().loadSnapshot(),
        regions,
        places,
        aliases,
        audit,
        events,
      }),
    );

    // [2/4] frontline override
    steps.push(
      await this.runCatalogStep({
        stepIndex: 1,
        label: STEP_LABELS[1],
        mode,
        snapshot: await new FrontlineCatalogProvider().loadSnapshot(),
        regions,
        places,
        aliases,
        audit,
        events,
      }),
    );

    if (mode === "plan") {
      steps.push(
        await this.runGeometryPlanStep(2),
        await this.runAdjacencyPlanStep(3),
      );
      this.deps.reporter?.finish(steps);
      return { mode, steps };
    }

    // [3/4] osm geometry — только после словарей
    await this.assertPlacesReady(places);
    steps.push(await this.runGeometryImportStep(2));

    // [4/4] adjacency
    steps.push(await this.runAdjacencyImportStep(3));

    this.deps.reporter?.finish(steps);
    return { mode, steps };
  }

  private async runCatalogStep(input: {
    stepIndex: number;
    label: string;
    mode: GeoCatalogImportMode;
    snapshot: GeoProviderSnapshot;
    regions: TypeOrmRegionRepository;
    places: TypeOrmPlaceRepository;
    aliases: TypeOrmPlaceAliasRepository;
    audit: TypeOrmSyncAuditRepository;
    events: TypeOrmDomainEventRepository;
  }): Promise<GeoCatalogStepStats> {
    const started = Date.now();
    this.deps.reporter?.stepBegin(input.label, input.stepIndex + 1, STEP_LABELS.length);

    if (input.mode === "plan") {
      const planner = new GeoSyncPlanService(
        new StaticGeoProvider(input.snapshot),
        input.regions,
        input.places,
        input.aliases,
      );
      await planner.plan({ skipSnapshot: true, snapshot: input.snapshot });
      const stats: GeoCatalogStepStats = {
        step: input.label,
        regions: input.snapshot.regions.length,
        places: input.snapshot.places.length,
        aliases: input.snapshot.aliases.length,
        durationMs: Date.now() - started,
      };
      this.deps.reporter?.stepDone(stats);
      return stats;
    }

    const applyService = new GeoSyncApplyService(
      new StaticGeoProvider(input.snapshot),
      input.regions,
      input.places,
      input.aliases,
      input.audit,
      input.events,
      new GeoSyncPlanService(
        new StaticGeoProvider(input.snapshot),
        input.regions,
        input.places,
        input.aliases,
      ),
    );

    const { plan, persist } = await applyService.apply({
      providerSnapshot: input.snapshot,
      persist: this.deps.persist,
    });

    const dbPlacesByKind = await this.countActivePlacesByKind();

    const stats: GeoCatalogStepStats = {
      step: input.label,
      regions: plan.region.added + plan.region.updated + plan.region.noop,
      places: plan.place.added + plan.place.updated + plan.place.noop,
      aliases: plan.alias.added + plan.alias.updated + plan.alias.noop,
      durationMs: Date.now() - started,
      debug: {
        snapshotPlaces: persist.snapshotPlaces,
        placeRowsBuilt: persist.placeRowsBuilt,
        unresolvedPlaceDrafts: persist.unresolvedPlaceDrafts,
        planPlaces: {
          added: plan.place.added,
          updated: plan.place.updated,
          noop: plan.place.noop,
        },
        dbPlacesByKind,
      },
    };
    this.deps.reporter?.stepDone(stats);
    return stats;
  }

  /** GROUP BY kind — без загрузки 150k строк в память. */
  private async countActivePlacesByKind(): Promise<Record<string, number>> {
    const rows = await this.deps.dataSource
      .getRepository(PlaceEntity)
      .createQueryBuilder("p")
      .select("p.kind", "kind")
      .addSelect("COUNT(*)", "count")
      .where("p.isActive = :active", { active: true })
      .groupBy("p.kind")
      .getRawMany<{ kind: string; count: string }>();

    return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
  }

  /** Не запускаем geometry link на пустой БД places. */
  private async assertPlacesReady(places: TypeOrmPlaceRepository): Promise<void> {
    const active = await places.listActive();
    const nonRegionPlaces = active.filter((place) => place.kind !== "region");
    if (nonRegionPlaces.length === 0) {
      throw new Error(
        "[geo:catalog:import] шаг 3 пропущен: нет places после tabular/frontline. " +
          "Проверьте наличие 03_all_cities.xlsx в data/geo/catalog/.",
      );
    }
  }

  private async runGeometryImportStep(stepIndex: number): Promise<GeoCatalogStepStats> {
    const started = Date.now();
    this.deps.reporter?.stepBegin(STEP_LABELS[2], stepIndex + 1, STEP_LABELS.length);

    const importer = new OsmRussiaGeoImporter(this.deps.dataSource);
    const result = await importer.run();

    const features =
      result.subjectsUpserted +
      result.districtsUpserted +
      result.cityDistrictsUpserted +
      result.federalDistrictsUpserted;

    const stats: GeoCatalogStepStats = {
      step: STEP_LABELS[2],
      features,
      linked: result.placesLinked,
      orphans: result.orphanFeatures,
      durationMs: Date.now() - started,
    };
    this.deps.reporter?.stepDone(stats);
    return stats;
  }

  private async runGeometryPlanStep(stepIndex: number): Promise<GeoCatalogStepStats> {
    const started = Date.now();
    this.deps.reporter?.stepBegin(STEP_LABELS[2], stepIndex + 1, STEP_LABELS.length);
    const stats: GeoCatalogStepStats = {
      step: STEP_LABELS[2],
      features: 0,
      linked: 0,
      orphans: 0,
      durationMs: Date.now() - started,
    };
    this.deps.reporter?.stepDone(stats);
    return stats;
  }

  private async runAdjacencyImportStep(stepIndex: number): Promise<GeoCatalogStepStats> {
    const started = Date.now();
    this.deps.reporter?.stepBegin(STEP_LABELS[3], stepIndex + 1, STEP_LABELS.length);

    const importer = new RegionAdjacencyImporter(this.deps.dataSource);
    const result = await importer.run();

    const stats: GeoCatalogStepStats = {
      step: STEP_LABELS[3],
      edges: result.edges,
      durationMs: Date.now() - started,
    };
    this.deps.reporter?.stepDone(stats);
    return stats;
  }

  private async runAdjacencyPlanStep(stepIndex: number): Promise<GeoCatalogStepStats> {
    const started = Date.now();
    this.deps.reporter?.stepBegin(STEP_LABELS[3], stepIndex + 1, STEP_LABELS.length);
    const stats: GeoCatalogStepStats = {
      step: STEP_LABELS[3],
      edges: 0,
      durationMs: Date.now() - started,
    };
    this.deps.reporter?.stepDone(stats);
    return stats;
  }
}
