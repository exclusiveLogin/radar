import type { GeoProviderSnapshot, IGeoSourceProvider } from "@radar/shared";

/** Провайдер с фиксированным snapshot — для пошагового catalog import. */
export class StaticGeoProvider implements IGeoSourceProvider {
  constructor(private readonly snapshot: GeoProviderSnapshot) {}

  loadSnapshot(): Promise<GeoProviderSnapshot> {
    return Promise.resolve(this.snapshot);
  }
}
