/**
 * Слияние дублей places по (region_id, kind, name_normalized).
 *
 * Дубли возникли после remap: один и тот же НП существовал под разными фантом-
 * вариантами субъекта и схлопнулся на канон. Survivor выбирается детерминированно:
 * сначала запись с fias_id, иначе самая старая (created_at).
 *
 * Производные ссылки (статусы/локации/evidence) у проигравших удаляются — их
 * перестроит reparse. Алиасы проигравших удаляются (у survivor есть свои).
 * parent_place_id детей переподключается на survivor.
 *
 * Запуск (из packages/api):
 *   npx tsx src/scripts/dedup-places.ts          # dry-run
 *   npx tsx src/scripts/dedup-places.ts --apply  # выполнить
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgresql://radar:radar@127.0.0.1:5432/radar";
  const client = new Client({ connectionString: url });
  await client.connect();

  // Группы дублей: массив id, упорядоченный так, что survivor первый
  // (fias_id NOT NULL раньше, затем по created_at).
  const groups = await client.query<{ ids: string[] }>(`
    SELECT array_agg(id ORDER BY (fias_id IS NULL), created_at) AS ids
    FROM places
    WHERE is_active
    GROUP BY region_id, kind, name_normalized
    HAVING COUNT(*) > 1
  `);

  const losers: string[] = [];
  const survivorByLoser = new Map<string, string>();
  for (const { ids } of groups.rows) {
    const [survivor, ...rest] = ids;
    for (const loser of rest) {
      losers.push(loser);
      survivorByLoser.set(loser, survivor);
    }
  }

  console.log(`Групп дублей: ${groups.rowCount}, проигравших к слиянию: ${losers.length}`);

  if (losers.length === 0) {
    await client.end();
    return;
  }
  if (!APPLY) {
    console.log("[dry-run] изменения НЕ применены. Повтори с --apply.");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    // Дети переподключаются на survivor (по одному, маппинг loser→survivor).
    for (const [loser, survivor] of survivorByLoser) {
      await client.query(`UPDATE places SET parent_place_id = $1 WHERE parent_place_id = $2`, [survivor, loser]);
    }
    // Производные ссылки проигравших удаляются — перестроит reparse.
    await client.query(`DELETE FROM event_locations WHERE place_id = ANY($1::uuid[])`, [losers]);
    await client.query(`DELETE FROM place_evidence WHERE place_id = ANY($1::uuid[])`, [losers]);
    await client.query(`DELETE FROM place_aliases WHERE place_id = ANY($1::uuid[])`, [losers]);
    await client.query(`DELETE FROM places WHERE id = ANY($1::uuid[])`, [losers]);
    await client.query("COMMIT");
    console.log(`[apply] слито дублей: ${losers.length}`);
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
