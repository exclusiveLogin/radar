import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "../../../../api");
const apiDist = path.join(apiRoot, "dist");
const apiSrc = path.join(apiRoot, "src");

/** Скомпилированные entity (Nest build) — без поломки декораторов в tsx на .ts. */
function resolveEntityGlob(): string {
  const distGlob = path.join(apiDist, "**", "*.entity.js");
  if (fs.existsSync(apiDist)) {
    return distGlob;
  }
  return path.join(apiSrc, "**", "*.entity.{ts,js}");
}

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
    entities: [resolveEntityGlob()],
    synchronize: false,
  });

  await dataSource.initialize();
  return dataSource;
}
