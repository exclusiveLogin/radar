/**
 * Переподключение фантом-регионов на канон и их удаление.
 *
 * Фантом-регион = строка regions с iso НЕ в формате RU-XX (раньше туда клали имя).
 * Канон = регион с настоящим ISO. Сопоставление детерминированное — по regionStemKey
 * (тот же SSOT, что в канонизаторе), без LLM.
 *
 * Действия (только при --apply, иначе dry-run):
 *   1. places.region_id  фантом → канон
 *   2. mat_parse_location.region_id фантом → канон
 *   3. DELETE place_aliases с region_id фантома (пересоздаются через geo:db:apply)
 *   4. DELETE фантом-регионы
 *
 * Запуск (из packages/api):
 *   npx tsx src/scripts/remap-phantom-regions.ts          # dry-run
 *   npx tsx src/scripts/remap-phantom-regions.ts --apply  # выполнить
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { regionStemKey } from "../infrastructure/geo-providers/region-canonicalization";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const APPLY = process.argv.includes("--apply");
const ISO_PATTERN = /^[A-Z]{2}-/;

type RegionRow = { id: string; iso: string | null; name: string; name_with_type: string | null };

/** Строит индекс канон-регионов по стему имени и имени-с-типом. */
function buildCanonByStem(canon: RegionRow[]): Map<string, RegionRow> {
  const index = new Map<string, RegionRow>();
  for (const region of canon) {
    index.set(regionStemKey(region.name), region);
    if (region.name_with_type) index.set(regionStemKey(region.name_with_type), region);
  }
  return index;
}

/** Сопоставляет фантом → канон по стему; собирает несопоставленные. */
function mapPhantomsToCanon(
  phantoms: RegionRow[],
  canonByStem: Map<string, RegionRow>,
): { pairs: Array<{ phantom: RegionRow; canon: RegionRow }>; unmapped: RegionRow[] } {
  const pairs: Array<{ phantom: RegionRow; canon: RegionRow }> = [];
  const unmapped: RegionRow[] = [];
  for (const phantom of phantoms) {
    const canon =
      canonByStem.get(regionStemKey(phantom.name)) ??
      (phantom.name_with_type ? canonByStem.get(regionStemKey(phantom.name_with_type)) : undefined);
    if (canon) pairs.push({ phantom, canon });
    else unmapped.push(phantom);
  }
  return { pairs, unmapped };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgresql://radar:radar@127.0.0.1:5432/radar";
  const client = new Client({ connectionString: url });
  await client.connect();

  const { rows } = await client.query<RegionRow>(
    `SELECT id, iso, name, name_with_type FROM regions`,
  );
  const canon = rows.filter((r) => r.iso && ISO_PATTERN.test(r.iso));
  const phantoms = rows.filter((r) => !r.iso || !ISO_PATTERN.test(r.iso));

  const { pairs, unmapped } = mapPhantomsToCanon(phantoms, buildCanonByStem(canon));

  console.log(`Регионы: канон=${canon.length}, фантомы=${phantoms.length}`);
  console.log(`Сопоставлено фантом→канон: ${pairs.length}, не сопоставлено: ${unmapped.length}`);
  if (unmapped.length > 0) {
    console.log("Несопоставленные (требуют ручного алиаса):", unmapped.map((r) => r.name));
    console.log("Прерываю — сначала добей MANUAL_REGION_STEM_REMAP.");
    await client.end();
    process.exit(1);
  }

  const phantomIds = phantoms.map((p) => p.id);
  const cnt = async (sql: string): Promise<number> =>
    Number((await client.query(sql, [phantomIds])).rows[0].c);
  const places = await cnt(`SELECT COUNT(*)::int c FROM places WHERE region_id = ANY($1::uuid[])`);
  const aliases = await cnt(`SELECT COUNT(*)::int c FROM place_aliases WHERE region_id = ANY($1::uuid[])`);
  const evloc = await cnt(`SELECT COUNT(*)::int c FROM mat_parse_location WHERE region_id = ANY($1::uuid[])`);
  console.log(`К переносу: places=${places}, mat_parse_location=${evloc}; к удалению: place_aliases=${aliases}, regions=${phantoms.length}`);

  if (!APPLY) {
    console.log("\n[dry-run] изменения НЕ применены. Повтори с --apply.");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    for (const { phantom, canon: target } of pairs) {
      await client.query(`UPDATE places SET region_id = $1 WHERE region_id = $2`, [target.id, phantom.id]);
      await client.query(`UPDATE mat_parse_location SET region_id = $1 WHERE region_id = $2`, [target.id, phantom.id]);
    }
    await client.query(`DELETE FROM place_aliases WHERE region_id = ANY($1::uuid[])`, [phantomIds]);
    await client.query(`DELETE FROM regions WHERE id = ANY($1::uuid[])`, [phantomIds]);
    await client.query("COMMIT");
    console.log(`\n[apply] готово: перенесено ${places} мест, удалено ${phantoms.length} фантом-регионов.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
