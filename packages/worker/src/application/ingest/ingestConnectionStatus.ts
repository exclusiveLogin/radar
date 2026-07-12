import type { IngestConnectionPhase, IngestProviderConnectionSnapshot } from "@radar/shared";

/** Runtime-снимок live-соединения ingest-провайдера (probe /status, не PostgreSQL). */
const byProviderId = new Map<string, IngestProviderConnectionSnapshot>();

/** SSOT фаз connecting/reconnecting/live для админки и worker probe. */
export const ingestConnectionStatus = {
  set(input: {
    providerId: string;
    providerKey: string;
    phase: IngestConnectionPhase;
    detail?: string | null;
  }): void {
    byProviderId.set(input.providerId, {
      providerId: input.providerId,
      providerKey: input.providerKey,
      phase: input.phase,
      detail: input.detail ?? null,
      updatedAt: new Date().toISOString(),
    });
  },

  clear(providerId: string): void {
    byProviderId.delete(providerId);
  },

  clearAll(): void {
    byProviderId.clear();
  },

  list(): IngestProviderConnectionSnapshot[] {
    return [...byProviderId.values()].sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  },
};
