import "reflect-metadata";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { getApiDistRoot } from "./resolveApiDistModule.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const root = path.resolve(here, "../../../../../");
  const rootEnv = path.join(root, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

/**
 * TypeORM DataSource для worker: только скомпилированные entity из `api/dist`.
 */
export async function createWorkerDataSource(): Promise<DataSource> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for worker db mode (set in root .env or vault).",
    );
  }

  const apiDist = getApiDistRoot();
  const entityGlob = path.join(apiDist, "**", "*.entity.js");

  const dataSource = new DataSource({
    type: "postgres",
    url: databaseUrl,
    entities: [entityGlob],
    synchronize: false,
  });

  await dataSource.initialize();
  return dataSource;
}
