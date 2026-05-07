/**
 * Заполняет geo_dataset_file из data/geo/artifacts/manifest.json (после npm run geo:sync).
 * Запуск из корня: npm run geo:seed
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

type ManifestFile = {
  artifactKey: string;
  relPath: string;
  sourceId: string;
  sourceRevision: string;
  cloneUrl: string;
  sha256: string;
  byteSize: number;
};

type Manifest = {
  version: number;
  generatedAt: string;
  files: ManifestFile[];
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан (корневой .env).");
    process.exit(1);
  }

  const manifestPath = path.resolve(
    __dirname,
    "../../../../",
    "data",
    "geo",
    "artifacts",
    "manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    console.error("Нет manifest.json. Сначала: npm run geo:sync");
    process.exit(1);
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Manifest;
  if (!manifest.files?.length) {
    console.log("manifest.files пуст — нечего сидировать.");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const f of manifest.files) {
      await client.query(
        `INSERT INTO geo_dataset_file (
          artifact_key, rel_path, sha256_hex, byte_size,
          source_id, source_revision, clone_url, manifest_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (artifact_key) DO UPDATE SET
          rel_path = EXCLUDED.rel_path,
          sha256_hex = EXCLUDED.sha256_hex,
          byte_size = EXCLUDED.byte_size,
          source_id = EXCLUDED.source_id,
          source_revision = EXCLUDED.source_revision,
          clone_url = EXCLUDED.clone_url,
          manifest_version = EXCLUDED.manifest_version`,
        [
          f.artifactKey,
          f.relPath,
          f.sha256,
          f.byteSize,
          f.sourceId,
          f.sourceRevision,
          f.cloneUrl,
          manifest.version,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(`Записано строк: ${manifest.files.length}`);
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
