/** Токен DaData из env; без него шаг dadata no-op (пайплайн не падает). */
export function loadDadataToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.DADATA_TOKEN?.trim();
  return token || undefined;
}

export function isDadataConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(loadDadataToken(env));
}
