import type { AliasDraft, PlaceDraft, RegionDraft } from "../schemas/geo/drafts";

export type GeoProviderSnapshot = {
  sourceId: string;
  sourceRevision: string;
  regions: RegionDraft[];
  places: PlaceDraft[];
  aliases: AliasDraft[];
};

export interface IGeoSourceProvider {
  loadSnapshot(): Promise<GeoProviderSnapshot>;
}
