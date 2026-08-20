/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Race-safe «стабильность» scope через persisted busy→stabilized claim.
 *          Не знает домен/RMQ — только store. true от reportIdle = эта реплика публикует событие.
 * ---
 */

/** Порт хранения статуса стабильности (БД или memory в тестах). */
export type StabilityStore = {
  /** Пометить scope «есть работа» — разрешает следующий idle-claim. */
  markBusy: (scopeKey: string) => Promise<void>;
  /**
   * Атомарно busy→stabilized.
   * @returns true только у победителя гонки (единственный publisher).
   */
  tryClaimStabilized: (scopeKey: string) => Promise<boolean>;
};

export type StabilityEngine = {
  reportBusy: (scopeKey: string) => Promise<void>;
  /** true — эта реплика единственная, кто зафиксировал переход busy→stabilized. */
  reportIdle: (scopeKey: string) => Promise<boolean>;
};

/** Scope keys — SSOT строковых ключей для pipeline / channel-backfill. */
export function pipelineStabilityScope(pipelineKey: string): string {
  return `pipeline:${pipelineKey}`;
}

export function channelBackfillStabilityScope(channelId: string): string {
  return `channel-backfill:${channelId}`;
}

/** Тонкая обёртка над store — одинаковый API для любого бэкенда. */
export function createStabilityEngine(store: StabilityStore): StabilityEngine {
  return {
    reportBusy: (scopeKey) => store.markBusy(scopeKey),
    reportIdle: (scopeKey) => store.tryClaimStabilized(scopeKey),
  };
}

/** In-memory store для unit-тестов (симулирует atomic claim). */
export function createMemoryStabilityStore(): StabilityStore {
  const status = new Map<string, "busy" | "stabilized">();
  return {
    async markBusy(scopeKey) {
      status.set(scopeKey, "busy");
    },
    async tryClaimStabilized(scopeKey) {
      if (status.get(scopeKey) !== "busy") return false;
      status.set(scopeKey, "stabilized");
      return true;
    },
  };
}
