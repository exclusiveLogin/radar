import type { IPlaceRepository, IRegionRepository } from "@radar/shared";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
} from "../handlers/inMemoryRepositories.js";
import { GeoValidationService } from "../parsing/geoValidationService.js";

/** GeoValidationService для тестов и offline parse pipeline. */
export function createTestGeoValidation(
  regions: IRegionRepository,
  places: IPlaceRepository = new InMemoryPlaceRepository(),
  aliases = new InMemoryPlaceAliasRepository(),
): GeoValidationService {
  return new GeoValidationService(regions, places, aliases);
}
