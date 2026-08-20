import { Injectable, ServiceUnavailableException } from "@nestjs/common";

const DRAIN_TIMEOUT_MS = 15_000;

export const PARSE_MAINTENANCE_CODE = "PARSE_MAINTENANCE";

/** 503 от gate — фоновые poll/push должны глотать, HTTP-клиентам отдавать как есть. */
export function isParseMaintenanceError(error: unknown): boolean {
  if (!(error instanceof ServiceUnavailableException)) return false;
  const body = error.getResponse();
  if (typeof body === "object" && body !== null && "code" in body) {
    return (body as { code?: string }).code === PARSE_MAINTENANCE_CODE;
  }
  return false;
}

/**
 * In-process maintenance для parse reset:
 * новые map/parse reads получают 503, уже начатые учитываются в drain.
 */
@Injectable()
export class ParseMaintenanceGate {
  private paused = false;
  private activeReads = 0;
  private readonly drainWaiters: Array<() => void> = [];

  /** Активен ли parse reset / maintenance. */
  isPaused(): boolean {
    return this.paused;
  }

  /** Закрыть вход новым map/parse reads. */
  pause(): void {
    this.paused = true;
  }

  /** Снять maintenance после завершения reset. */
  resume(): void {
    this.paused = false;
  }

  /**
   * Выполнить read под учётом drain.
   * Инкремент до проверки pause закрывает гонку pause→TRUNCATE→SELECT.
   */
  async runRead<T>(fn: () => Promise<T>): Promise<T> {
    this.activeReads += 1;
    if (this.paused) {
      this.releaseRead();
      throw new ServiceUnavailableException({
        code: PARSE_MAINTENANCE_CODE,
        message: "Идёт сброс parse pipeline",
      });
    }

    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  /** Дождаться завершения уже начатых reads после pause. */
  async waitForDrain(timeoutMs = DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.activeReads === 0) return;

    await Promise.race([
      new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve);
        // Подписка могла случиться уже после последнего releaseRead.
        if (this.activeReads === 0) {
          const idx = this.drainWaiters.indexOf(resolve);
          if (idx >= 0) this.drainWaiters.splice(idx, 1);
          resolve();
        }
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Parse maintenance drain timeout (${timeoutMs}ms), activeReads=${this.activeReads}`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  }

  private releaseRead(): void {
    this.activeReads = Math.max(0, this.activeReads - 1);
    if (this.activeReads > 0) return;
    const waiters = this.drainWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
