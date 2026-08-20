import "reflect-metadata";
import * as dotenv from "dotenv";
import * as path from "node:path";
import { typeOrmEntities } from "@radar/persistence";
import { DataSource } from "typeorm";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const root = path.resolve(here, "../../../../../");
  const rootEnv = path.join(root, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

/**
 * TypeORM DataSource worker использует общий persistence package.
 */
export async function createWorkerDataSource(): Promise<DataSource> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for worker db mode (set in root .env or vault).",
    );
  }

  const dataSource = new DataSource({
    type: "postgres",
    url: databaseUrl,
    entities: typeOrmEntities,
    synchronize: false,
  });

  await dataSource.initialize();
  return dataSource;
}
