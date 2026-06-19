/** Предупреждение при вызове устаревшего npm lifecycle имени. */
export function warnDeprecatedNpmScript(canonical: string): void {
  const event = process.env.npm_lifecycle_event;
  if (!event || event === canonical) return;
  console.warn(
    `⚠ Устарело: npm run ${event} → npm run radar … или npm run ${canonical} -w @radar/worker`,
  );
}
