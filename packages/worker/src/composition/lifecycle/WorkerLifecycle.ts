/**
 * ---
 * layer: worker/composition
 * domain: runtime lifecycle
 * purpose: Упорядоченно завершает ресурсы worker в обратном порядке регистрации.
 * ---
 */

export type WorkerTeardown = () => void | Promise<void>;

/** Реестр ресурсов, которые нужно остановить при завершении worker. */
export class WorkerLifecycle {
  private readonly teardowns: WorkerTeardown[] = [];

  register(teardown: WorkerTeardown): void {
    this.teardowns.push(teardown);
  }

  async shutdown(): Promise<void> {
    for (const teardown of [...this.teardowns].reverse()) {
      await teardown();
    }
  }
}
