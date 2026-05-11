import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";function loadEnv(): void {
  const root = path.resolve(__dirname, "../../..");
  const rootEnv = path.join(root, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for TypeORM CLI (set in root .env or vault).",
  );
}

export default new DataSource({
  type: "postgres",
  url: databaseUrl,
  entities: [path.join(__dirname, "**/*.entity.{ts,js}")],
  migrations: [path.join(__dirname, "migrations", "*.{ts,js}")],
  synchronize: false,
});
