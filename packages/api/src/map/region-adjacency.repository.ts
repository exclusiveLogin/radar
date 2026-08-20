import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { TypeOrmRegionAdjacencyRepository } from "@radar/persistence";

/** Nest-адаптер над общей реализацией смежности регионов (SSOT — region_adjacency). */
@Injectable()
export class RegionAdjacencyRepository extends TypeOrmRegionAdjacencyRepository {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(dataSource);
  }
}
