import { BehaviorSubject } from "rxjs";
import type { StatusDictionary } from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { reportAppError } from "./appLogStore";

export const statusDictionary$ = new BehaviorSubject<StatusDictionary | null>(null);

let started = false;

/** Bootstrap словаря статусов для подписей иконок угроз. */
export function startStatusDictionaryStore(): void {
  if (started) return;
  started = true;
  void mapApi
    .statusDictionary()
    .then((dict) => statusDictionary$.next(dict))
    .catch((error) => reportAppError("Словарь статусов", error));
}

/** Человекочитаемый title по коду статуса. */
export function statusTitle(code: string | undefined, fallback?: string): string {
  if (!code) return fallback ?? "—";
  const entry = statusDictionary$.value?.statuses.find((row) => row.code === code);
  return entry?.title ?? fallback ?? code;
}
