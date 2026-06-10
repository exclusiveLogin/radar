import * as fs from "node:fs";
import type { DataSource } from "typeorm";
import { TypeOrmRegionRepository } from "../persistence/typeorm-region.repository";
import { resolveGeoCatalogPath } from "./catalog-paths";

export type AdjacencyImportStats = {
  edges: number;
  skippedIso: string[];
};

type AdjacencyFile = {
  adjacency?: Record<string, string[]>;
};

/**
 * Шаг 4/4: adjacency.json → region_adjacency.
 * ISO → region_id через таблицу regions.
 */
export class RegionAdjacencyImporter {
  private readonly regions: TypeOrmRegionRepository;

  constructor(
    private readonly dataSource: DataSource,
    private readonly filePath = resolveGeoCatalogPath("relations", "adjacency.json"),
  ) {
    this.regions = new TypeOrmRegionRepository(dataSource);
  }

  async run(): Promise<AdjacencyImportStats> {
    if (!fs.existsSync(this.filePath)) {
      return { edges: 0, skippedIso: [] };
    }

    const raw = fs.readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as AdjacencyFile;
    const adjacency = parsed.adjacency ?? {};

    const activeRegions = await this.regions.listActive();
    const regionIdByIso = new Map<string, string>();
    for (const region of activeRegions) {
      if (region.iso) {
        regionIdByIso.set(region.iso, region.id);
      }
    }

    const skippedIso = new Set<string>();
    let edges = 0;

    for (const [iso, neighbors] of Object.entries(adjacency)) {
      const regionId = regionIdByIso.get(iso);
      if (!regionId) {
        skippedIso.add(iso);
        continue;
      }

      for (const neighborIso of neighbors) {
        const neighborId = regionIdByIso.get(neighborIso);
        if (!neighborId) {
          skippedIso.add(neighborIso);
          continue;
        }

        await this.dataSource.query(
          `
          INSERT INTO region_adjacency (region_id, neighbor_region_id)
          VALUES ($1::uuid, $2::uuid)
          ON CONFLICT (region_id, neighbor_region_id) DO NOTHING
          `,
          [regionId, neighborId],
        );
        edges++;
      }
    }

    return { edges, skippedIso: [...skippedIso] };
  }
}
