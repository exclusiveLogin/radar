import type { IngestConnectionPhase, IngestProviderConnectionSnapshot } from "@radar/shared";

/** Runtime-снимок live-соединения ingest-провайдера (probe /status, не PostgreSQL). */
const byProviderId = new Map<string, IngestProviderConnectionSnapshot>();
/** Провайдеры, у которых startDuty уже прошёл — TCP reconnect не должен откатывать в connected. */
const dutyActive = new Set<string>();

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

  get(providerId: string): IngestProviderConnectionSnapshot | undefined {
    return byProviderId.get(providerId);
  },

  /** Live duty поднят (после успешного startDuty). */
  setDutyActive(providerId: string, active: boolean): void {
    if (active) dutyActive.add(providerId);
    else dutyActive.delete(providerId);
  },

  isDutyActive(providerId: string): boolean {
    return dutyActive.has(providerId);
  },

  clear(providerId: string): void {
    byProviderId.delete(providerId);
    dutyActive.delete(providerId);
  },

  clearAll(): void {
    byProviderId.clear();
    dutyActive.clear();
  },

  list(): IngestProviderConnectionSnapshot[] {
    return [...byProviderId.values()].sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  },
};
