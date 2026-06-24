#!/usr/bin/env node
/**
 * Скачивание OSM .pbf — SSOT проверка: MD5 с Geofabrik ({url}.md5).
 * Resume через HTTP Range. Без osmium/magic-byte эвристик.
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { createRootCliReporter, parseCliFlags } from '../cli-reporter.mjs';
import { repoRoot } from '../utils.mjs';
import { loadGeoBasemapManifest } from './loadGeoBasemapManifest.mjs';

const MIB = 1024 * 1024;
/** Минимальный размер валидного regional .pbf (защита от редиректа на HTML/пустой ответ). */
const MIN_PBF_BYTES = MIB;

const { verbose } = parseCliFlags();
const reporter = createRootCliReporter({ verbose });
const manifest = loadGeoBasemapManifest(repoRoot);
const sourcesDir = join(repoRoot, 'data', 'tiles', 'sources');
const force = process.argv.includes('--force');

mkdirSync(sourcesDir, { recursive: true });

/** @param {string} url */
async function fetchGeofabrikMd5(url) {
  const res = await fetch(`${url}.md5`, { redirect: 'follow' });
  if (!res.ok) return null;
  const line = (await res.text()).trim().split(/\r?\n/)[0] ?? '';
  const match = /^([a-f0-9]{32})\b/i.exec(line);
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {string} filePath
 * @param {(bytes: number) => void} [onProgress]
 */
async function md5File(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    let bytes = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
      onProgress?.(bytes);
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** @param {string} path @param {string} expectedMd5 */
async function md5Matches(path, expectedMd5) {
  const actual = await md5File(path);
  return actual === expectedMd5.toLowerCase();
}

/** @param {number} bytes */
function bytesToTotalMb(bytes) {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.ceil(bytes / MIB));
}

/**
 * @param {{ id: string, url: string, filename: string, checksumMd5?: string }} source
 */
async function downloadFile(source) {
  const dest = join(sourcesDir, source.filename);
  const expectedMd5 =
    source.checksumMd5?.trim().toLowerCase() ?? (await fetchGeofabrikMd5(source.url));

  if (!expectedMd5) {
    reporter.log(
      `\x1b[33m[tiles:download] ${source.id}: нет .md5 на Geofabrik — проверка размера ≥ 1 MiB\x1b[0m`,
    );
  }

  let startOffset = 0;

  if (!force && existsSync(dest)) {
    const size = statSync(dest).size;

    if (expectedMd5 && (await md5Matches(dest, expectedMd5))) {
      reporter.log(
        `[tiles:download] skip ${source.id} (MD5 ok, ${(size / MIB).toFixed(1)} MiB)`,
      );
      return;
    }

    if (size > 0 && size < MIN_PBF_BYTES) {
      reporter.log(
        `[tiles:download] ${source.id}: удаляем битый файл (${(size / MIB).toFixed(2)} MiB)`,
      );
      unlinkSync(dest);
    } else if (size > 0) {
      startOffset = size;
      reporter.log(
        `[tiles:download] resume ${source.id} с ${(size / MIB).toFixed(1)} MiB` +
          (expectedMd5 ? ' (MD5 ещё не совпал)' : ''),
      );
    }
  }

  if (force && existsSync(dest)) {
    reporter.log(`[tiles:download] --force: удаляем ${source.filename}`);
    unlinkSync(dest);
    startOffset = 0;
  }

  if (startOffset === 0) {
    reporter.log(`[tiles:download] ${source.id} ← ${source.url}`);
  }

  /** @type {Record<string, string>} */
  const headers = {};
  if (startOffset > 0) headers.Range = `bytes=${startOffset}-`;

  let response = await fetch(source.url, { headers, redirect: 'follow' });

  if (startOffset > 0 && response.status === 200) {
    reporter.log(`[tiles:download] ${source.id}: Range не поддержан → с нуля`);
    unlinkSync(dest);
    startOffset = 0;
    response = await fetch(source.url, { redirect: 'follow' });
  }

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} для ${source.url}`);
  }

  const finalUrl = response.url ?? source.url;
  if (!/\.osm\.pbf(?:\?|$)/i.test(finalUrl)) {
    throw new Error(
      `Редирект не на .pbf для ${source.id}\n` +
        `  запрос:  ${source.url}\n` +
        `  итог:    ${finalUrl}\n` +
        `Проверьте URL в data/geo/tiles.manifest.json (часто europe/… для регионов вне корня).`,
    );
  }
  if (startOffset > 0 && response.status !== 206) {
    throw new Error(`Ожидали HTTP 206, получили ${response.status}`);
  }

  const contentRange = response.headers.get('content-range');
  const getPart = Number(response.headers.get('content-length') ?? 0) || 0;
  let totalBytes = 0;
  if (contentRange) {
    const m = /\/(\d+)\s*$/.exec(contentRange);
    if (m) totalBytes = Number(m[1]);
  } else if (getPart > 0) {
    totalBytes = startOffset > 0 ? startOffset + getPart : getPart;
  }

  const totalMb = bytesToTotalMb(totalBytes);
  const stage = reporter.startStage(`download:${source.id}`, totalMb > 0 ? totalMb : 0);
  if (totalMb > 0) stage.setTotal(totalMb);

  let received = startOffset;
  let lastTickMb = Math.floor(startOffset / MIB);
  if (lastTickMb > 0 && totalMb > 0) stage.tick(lastTickMb, { mib: lastTickMb });

  const reader = response.body.getReader();
  const writer = createWriteStream(dest, { flags: startOffset > 0 ? 'a' : 'w' });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!writer.write(Buffer.from(value))) {
        await new Promise((resolve) => writer.once('drain', resolve));
      }
      const doneMb = Math.floor(received / MIB);
      if (totalMb > 0) {
        const delta = doneMb - lastTickMb;
        if (delta > 0) {
          stage.tick(delta, { mib: doneMb });
          lastTickMb = doneMb;
        }
      } else {
        stage.update({ mib: doneMb });
      }
    }
    writer.end();
    await finished(writer);
  } catch (err) {
    writer.destroy();
    throw err;
  }

  const fileSize = statSync(dest).size;
  stage.done();

  if (fileSize < MIN_PBF_BYTES) {
    throw new Error(
      `Подозрительно малый файл ${source.filename}: ${(fileSize / MIB).toFixed(2)} MiB\n` +
        `  URL: ${source.url}\n` +
        `  итог GET: ${finalUrl}\n` +
        `Удалите файл и повторите download (--force) или исправьте URL в manifest.`,
    );
  }

  if (expectedMd5) {
    reporter.log(`[tiles:download] ${source.id}: проверка MD5…`);
    const hashStage = reporter.startStage(`md5:${source.id}`, bytesToTotalMb(fileSize));
    const actual = await md5File(dest, (bytes) => {
      const mb = Math.floor(bytes / MIB);
      hashStage.tick(0, { mib: mb });
    });
    hashStage.done();

    if (actual !== expectedMd5) {
      throw new Error(
        `MD5 не совпал для ${source.filename}\n` +
          `  ожидание: ${expectedMd5}\n` +
          `  файл:     ${actual}\n` +
          `Файл на диске сохранён (${(fileSize / MIB).toFixed(1)} MiB). Повторите download — resume.`,
      );
    }
    reporter.log(`[tiles:download] MD5 ok ${source.id}`);
  }

  reporter.log(`[tiles:download] готово ${source.filename} (${(fileSize / MIB).toFixed(1)} MiB)`);
}

async function main() {
  reporter.log('\x1b[36m=== tiles:download ===\x1b[0m');
  reporter.log('\x1b[90mПроверка: MD5 с download.geofabrik.de/{file}.md5\x1b[0m');
  for (const source of manifest.sources) {
    await downloadFile(source);
  }
  reporter.log('\x1b[32mtiles:download completed\x1b[0m');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
