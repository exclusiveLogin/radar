import type { IngestConnectionPhase, IngestProviderConnectionSnapshot } from "@radar/shared";
import { Observable, Subject } from "rxjs";
import { filter, first, map, startWith } from "rxjs/operators";

const LIVE_GONE: readonly IngestConnectionPhase[] = ["disconnected", "error", "reconnecting"];

/** Runtime-снимок live-соединения ingest-провайдера (probe /status, не PostgreSQL). */
const byProviderId = new Map<string, IngestProviderConnectionSnapshot>();
/** Провайдеры, у которых startDuty уже прошёл — TCP reconnect не должен откатывать в connected. */
const dutyActive = new Set<string>();
/** Эмит providerId при любом изменении phase/duty. */
const changed$ = new Subject<string>();

export type IngestConnectionWatch = {
  phase: IngestConnectionPhase;
  dutyActive: boolean;
};

const readWatch = (providerId: string): IngestConnectionWatch | null => {
  const snap = byProviderId.get(providerId);
  if (!snap) return null;
  return { phase: snap.phase, dutyActive: dutyActive.has(providerId) };
};

const emit = (providerId: string): void => {
  changed$.next(providerId);
};

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
    emit(input.providerId);
  },

  get(providerId: string): IngestProviderConnectionSnapshot | undefined {
    return byProviderId.get(providerId);
  },

  /** Live duty поднят (после успешного startDuty). */
  setDutyActive(providerId: string, active: boolean): void {
    if (active) dutyActive.add(providerId);
    else dutyActive.delete(providerId);
    emit(providerId);
  },

  isDutyActive(providerId: string): boolean {
    return dutyActive.has(providerId);
  },

  /** Поток снимка phase+duty; старт с текущего значения. */
  watch(providerId: string): Observable<IngestConnectionWatch | null> {
    return changed$.pipe(
      filter((id) => id === providerId),
      map(() => readWatch(providerId)),
      startWith(readWatch(providerId)),
    );
  },

  /** Первый снимок, когда duty снята или phase ∈ disconnected/error/reconnecting. */
  untilDown$(providerId: string): Observable<IngestConnectionWatch> {
    return this.watch(providerId).pipe(
      first((s): s is IngestConnectionWatch => !!s && (!s.dutyActive || LIVE_GONE.includes(s.phase))),
    );
  },

  clear(providerId: string): void {
    byProviderId.delete(providerId);
    dutyActive.delete(providerId);
    emit(providerId);
  },

  clearAll(): void {
    const ids = [...byProviderId.keys()];
    byProviderId.clear();
    dutyActive.clear();
    for (const id of ids) emit(id);
  },

  list(): IngestProviderConnectionSnapshot[] {
    return [...byProviderId.values()].sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  },
};
