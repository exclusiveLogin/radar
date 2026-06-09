/**
 * Chunk-upsert для geo:db:apply — единственное место tick progress, без контрактов в repos.
 */
const DEFAULT_CHUNK_SIZE = 100;

/** Upsert пачками; tick вызывается на каждую успешно записанную строку (через размер chunk). */
export async function upsertManyInChunks<T>(
  rows: T[],
  upsert: (chunk: T[]) => Promise<void>,
  tick?: (delta: number) => void,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<void> {
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await upsert(chunk);
    tick?.(chunk.length);
  }
}
