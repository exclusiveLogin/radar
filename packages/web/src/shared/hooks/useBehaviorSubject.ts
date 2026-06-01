import { useSyncExternalStore } from "react";
import type { BehaviorSubject } from "rxjs";

/**
 * Подписка на BehaviorSubject без лишнего кадра React (в отличие от useState в useObservable).
 * Для выделения на карте и чипах — отклик в том же тике, что и selectRegion().
 */
export function useBehaviorSubject<T>(subject: BehaviorSubject<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => {
      const sub = subject.subscribe(onStoreChange);
      return () => sub.unsubscribe();
    },
    () => subject.getValue(),
    () => subject.getValue(),
  );
}
