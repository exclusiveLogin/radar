import { formatTelegramApiIdInvalidHelp, type TelegramAppCredentials } from "./telegramAppCredentials.js";

export function isTelegramApiIdInvalidError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = "errorMessage" in err ? String((err as { errorMessage?: string }).errorMessage) : "";
  const message = err instanceof Error ? err.message : String(err);
  return msg === "API_ID_INVALID" || message.includes("API_ID_INVALID");
}

export function wrapTelegramApiIdInvalid(
  err: unknown,
  source: TelegramAppCredentials["source"],
): Error {
  if (!isTelegramApiIdInvalidError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  return new Error(formatTelegramApiIdInvalidHelp(source), { cause: err });
}
