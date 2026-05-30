import { useEffect, useState } from "react";
import type { Observable } from "rxjs";

/** Подписывает компонент на Observable; возвращает последнее значение. */
export function useObservable<T>(source: Observable<T>, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = source.subscribe(setValue);
    return () => sub.unsubscribe();
  }, [source]);
  return value;
}
