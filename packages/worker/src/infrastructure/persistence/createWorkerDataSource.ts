import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(here, "../../../../api/src");

function loadEnv(): void {
  const root = path.resolve(here, "../../../../../");
  const rootEnv = path.join(root, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

/**
 * TypeORM DataSource для worker (тот же DATABASE_URL и entity-паттерн, что у API CLI).
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
    entities: [path.join(apiSrc, "**/*.entity.{ts,js}")],
    synchronize: false,
  });

  await dataSource.initialize();
  return dataSource;
}
