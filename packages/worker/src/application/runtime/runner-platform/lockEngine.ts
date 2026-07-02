/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: In-process cooperative lock по ключу pipeline — не даёт двум тикам одного
 *          job'а выполняться параллельно (аналог `this.ticking` guard в существующих демонах,
 *          но переиспользуемый для любого pipeline).
 * ---
 */

export type LockHandle = { release: () => void };

export type LockEngine = {
  tryAcquire: (key: string) => LockHandle | null;
  isHeld: (key: string) => boolean;
};

export function createLockEngine(): LockEngine {
  const held = new Set<string>();
  return {
    tryAcquire(key: string): LockHandle | null {
      if (held.has(key)) return null;
      held.add(key);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          held.delete(key);
        },
      };
    },
    isHeld: (key: string) => held.has(key),
  };
}
