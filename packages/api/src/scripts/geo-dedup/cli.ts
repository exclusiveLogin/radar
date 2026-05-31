import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { PlaceDedupService, type SqlRunner } from "../../application/geo-dedup/dedup-places.service";

/** Применить слияние по умолчанию; --dry-run только считает дубли. */
function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function withDataSource<T>(ds: DataSource, fn: () => Promise<T>): Promise<T> {
  if (!ds.isInitialized) {
    await ds.initialize();
  }
  try {
    return await fn();
  } finally {
    if (ds.isInitialized) {
      await ds.destroy();
    }
  }
}

async function run(): Promise<void> {
  const dryRun = isDryRun();
  const service = new PlaceDedupService();

  await withDataSource(dataSource, async () => {
    if (dryRun) {
      const runner: SqlRunner = (sql, params) => dataSource.query(sql, params);
      const result = await service.plan(runner);
      console.log(JSON.stringify({ mode: "dry-run", result }, null, 2));
      return;
    }

    // apply: всё слияние в одной транзакции (repoint ссылок → удаление пустых).
    const result = await dataSource.transaction(async (manager) => {
      const runner: SqlRunner = (sql, params) => manager.query(sql, params);
      return service.apply(runner);
    });
    console.log(JSON.stringify({ mode: "apply", result }, null, 2));
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
