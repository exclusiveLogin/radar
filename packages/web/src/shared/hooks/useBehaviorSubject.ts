import { useEffect, useState } from "react";
import type { BehaviorSubject } from "rxjs";

/**
 * Подписка на BehaviorSubject с мгновенной инициализацией и корректным обновлением.
 *
 * Почему не useSyncExternalStore:
 * BehaviorSubject вызывает subscriber синхронно в момент subscribe — это нарушает
 * контракт useSyncExternalStore (onStoreChange не должен вызываться во время подписки),
 * что в React 18 concurrent mode приводит к потере обновлений.
 *
 * Паттерн: useState lazy initializer читает текущее значение синхронно (без пустого кадра),
 * useEffect синхронизирует если значение сменилось до mount и подписывается на будущие эмиссии.
 */
export function useBehaviorSubject<T>(subject: BehaviorSubject<T>): T {
  const [value, setValue] = useState<T>(() => subject.getValue());

  useEffect(() => {
    // Синхронизируем значение, если оно сменилось между render и mount
    setValue(subject.getValue());
    const sub = subject.subscribe(setValue);
    return () => sub.unsubscribe();
  }, [subject]);

  return value;
}
