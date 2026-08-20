/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Generic курсор-движок — читает/пишет/сбрасывает курсор конкретного pipeline.
 *          Форму курсора (watermark, offset, timestamp-range и т.д.) определяет домен через `CursorStore`.
 * ---
 */

export type CursorStore<TCursor> = {
  read: () => Promise<TCursor>;
  write: (cursor: TCursor) => Promise<void>;
  /** Сброс к началу — используется при rebuild (`cursor -> start` из семантики раннера). */
  reset: () => Promise<void>;
};

export type CursorEngine<TCursor> = {
  current: () => Promise<TCursor>;
  advance: (next: TCursor) => Promise<void>;
  resetToStart: () => Promise<void>;
};

/** Тонкая обёртка над `CursorStore` — платформенное API одинаковое для любого домена. */
export function createCursorEngine<TCursor>(store: CursorStore<TCursor>): CursorEngine<TCursor> {
  return {
    current: () => store.read(),
    advance: (next) => store.write(next),
    resetToStart: () => store.reset(),
  };
}
