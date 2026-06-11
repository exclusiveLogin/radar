#!/usr/bin/env node
/**
 * Сравнение Chrome/V8 .heapsnapshot: рост по типам, object names, retainer hints.
 *
 * Usage:
 *   node scripts/heap-snapshot-diff.mjs <before.heapsnapshot> <after.heapsnapshot>
 *   node scripts/heap-snapshot-diff.mjs <single.heapsnapshot>
 *   node scripts/heap-snapshot-diff.mjs before after --dominators-lite --json=out.json
 */
import fs from "node:fs";
import path from "node:path";

const HINT_NAMES = /map|array|geojson|webgl|detached|feature|subscription|websocket/i;

function loadSnapshot(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не найден: ${abs}`);
  }
  const json = JSON.parse(fs.readFileSync(abs, "utf8"));
  const meta = json.snapshot.meta;
  const nf = meta.node_fields;
  const nt0 = meta.node_types[0];
  const ti = nf.indexOf("type");
  const ni = nf.indexOf("name");
  const si = nf.indexOf("self_size");
  const ei = nf.indexOf("edge_count");
  const idIdx = nf.indexOf("id");
  const stride = nf.length;
  const nodes = json.nodes;
  const strings = json.strings;
  const nodeCount = nodes.length / stride;

  const byType = new Map();
  const byObjectName = new Map();
  const nodeRecords = [];

  for (let i = 0; i < nodes.length; i += stride) {
    const typeName = nt0[nodes[i + ti]];
    const name = strings[nodes[i + ni]] ?? "";
    const selfSize = nodes[i + si] ?? 0;
    const edgeCount = nodes[i + ei] ?? 0;
    const nodeId = nodes[i + idIdx];
    const nodeIndex = i / stride;

    const typeAcc = byType.get(typeName) ?? { count: 0, size: 0 };
    typeAcc.count += 1;
    typeAcc.size += selfSize;
    byType.set(typeName, typeAcc);

    if (typeName === "object" || typeName === "native" || typeName === "closure") {
      const short = name.slice(0, 120);
      const objAcc = byObjectName.get(short) ?? { count: 0, size: 0 };
      objAcc.count += 1;
      objAcc.size += selfSize;
      byObjectName.set(short, objAcc);
    }

    nodeRecords.push({ nodeIndex, nodeId, typeName, name, selfSize, edgeCount });
  }

  return {
    file: path.basename(abs),
    path: abs,
    nodeCount,
    byType,
    byObjectName,
    nodeRecords,
    edges: json.edges,
    edgeFields: meta.edge_fields,
    edgeTypes: meta.edge_types,
    strings,
    stride,
    nodes,
    nf,
    nodeTypes: nt0,
  };
}

function analyze(snapshot) {
  const totalSize = [...snapshot.byType.values()].reduce((sum, row) => sum + row.size, 0);
  const byType = [...snapshot.byType.entries()]
    .map(([type, row]) => ({
      type,
      count: row.count,
      sizeMb: +(row.size / 1024 / 1024).toFixed(2),
    }))
    .sort((a, b) => b.sizeMb - a.sizeMb);

  const topObjects = [...snapshot.byObjectName.entries()]
    .map(([name, row]) => ({
      name,
      count: row.count,
      sizeMb: +(row.size / 1024 / 1024).toFixed(2),
    }))
    .sort((a, b) => b.sizeMb - a.sizeMb)
    .slice(0, 20);

  const hints = [...snapshot.byObjectName.entries()]
    .filter(([name]) => HINT_NAMES.test(name))
    .map(([name, row]) => ({
      name,
      count: row.count,
      sizeMb: +(row.size / 1024 / 1024).toFixed(2),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    file: snapshot.file,
    nodeCount: snapshot.nodeCount,
    totalMb: +(totalSize / 1024 / 1024).toFixed(2),
    byType,
    topObjects,
    retainerHints: hints,
  };
}

function diffSnapshots(before, after) {
  const typeDelta = [];
  const allTypes = new Set([...before.byType.keys(), ...after.byType.keys()]);
  for (const type of allTypes) {
    const b = before.byType.get(type) ?? { count: 0, size: 0 };
    const a = after.byType.get(type) ?? { count: 0, size: 0 };
    typeDelta.push({
      type,
      countDelta: a.count - b.count,
      sizeDeltaMb: +((a.size - b.size) / 1024 / 1024).toFixed(2),
      beforeCount: b.count,
      afterCount: a.count,
    });
  }
  typeDelta.sort((x, y) => y.sizeDeltaMb - x.sizeDeltaMb);

  const objectDelta = [];
  const allNames = new Set([...before.byObjectName.keys(), ...after.byObjectName.keys()]);
  for (const name of allNames) {
    const b = before.byObjectName.get(name) ?? { count: 0, size: 0 };
    const a = after.byObjectName.get(name) ?? { count: 0, size: 0 };
    const countDelta = a.count - b.count;
    const sizeDeltaMb = +((a.size - b.size) / 1024 / 1024).toFixed(2);
    if (countDelta === 0 && sizeDeltaMb === 0) continue;
    objectDelta.push({
      name,
      countDelta,
      sizeDeltaMb,
      afterCount: a.count,
    });
  }
  objectDelta.sort((x, y) => y.sizeDeltaMb - x.sizeDeltaMb || y.countDelta - x.countDelta);

  const hintGrowth = objectDelta
    .filter((row) => HINT_NAMES.test(row.name))
    .slice(0, 25);

  return {
    before: before.file,
    after: after.file,
    nodeCountDelta: after.nodeCount - before.nodeCount,
    totalMbDelta: +(
      ([...after.byType.values()].reduce((s, r) => s + r.size, 0) -
        [...before.byType.values()].reduce((s, r) => s + r.size, 0)) /
      1024 /
      1024
    ).toFixed(2),
    byType: typeDelta.slice(0, 15),
    topObjectGrowth: objectDelta.slice(0, 25),
    retainerHints: hintGrowth,
  };
}

/** BFS 1-hop: кто ссылается на топ выросших object nodes (упрощённый retainer trace). */
function dominatorsLite(beforeSnap, afterSnap, topN = 20) {
  const growth = diffSnapshots(beforeSnap, afterSnap).topObjectGrowth
    .filter((row) => row.countDelta > 0)
    .slice(0, topN);
  if (growth.length === 0) return [];

  const nameToIndices = new Map();
  for (const rec of afterSnap.nodeRecords) {
    if (rec.typeName !== "object") continue;
    const short = rec.name.slice(0, 120);
    if (!nameToIndices.has(short)) nameToIndices.set(short, []);
    nameToIndices.get(short).push(rec.nodeIndex);
  }

  const edgeTypeIdx = afterSnap.edgeFields.indexOf("type");
  const edgeNameIdx = afterSnap.edgeFields.indexOf("name_or_index");
  const edgeToIdx = afterSnap.edgeFields.indexOf("to_node");
  const edgeStride = afterSnap.edgeFields.length;
  const edges = afterSnap.edges;
  const edgeTypeNames = afterSnap.edgeTypes[0];

  const incoming = new Map();
  for (let e = 0; e < edges.length; e += edgeStride) {
    const fromNode = Math.floor(e / edgeStride);
    const toNode = edges[e + edgeToIdx];
    const edgeType = edgeTypeNames[edges[e + edgeTypeIdx]] ?? "unknown";
    const nameRaw = edges[e + edgeNameIdx];
    const edgeName =
      typeof nameRaw === "number" && nameRaw >= 0
        ? afterSnap.strings[nameRaw] ?? String(nameRaw)
        : String(nameRaw);
    if (!incoming.has(toNode)) incoming.set(toNode, []);
    incoming.get(toNode).push({ fromNode, edgeType, edgeName });
  }

  const results = [];
  for (const row of growth) {
    const indices = nameToIndices.get(row.name) ?? [];
    const retainers = new Map();
    for (const idx of indices.slice(0, 5)) {
      for (const inc of incoming.get(idx) ?? []) {
        const from = afterSnap.nodeRecords[inc.fromNode];
        if (!from) continue;
        const key = `${from.typeName}:${from.name.slice(0, 80)} via ${inc.edgeType}/${inc.edgeName}`;
        retainers.set(key, (retainers.get(key) ?? 0) + 1);
      }
    }
    results.push({
      object: row.name,
      countDelta: row.countDelta,
      retainers: [...retainers.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count })),
    });
  }
  return results;
}

function printReport(singleOrDiff, dominators) {
  console.log("\n=== Heap snapshot analysis ===\n");
  if (singleOrDiff.before) {
    console.log(`Before: ${singleOrDiff.before}`);
    console.log(`After:  ${singleOrDiff.after}`);
    console.log(`Nodes delta: ${singleOrDiff.nodeCountDelta}`);
    console.log(`Self-size delta: ${singleOrDiff.totalMbDelta} MB\n`);
    console.log("By type (top growth):");
    for (const row of singleOrDiff.byType) {
      console.log(
        `  ${row.type.padEnd(16)} count ${String(row.countDelta).padStart(8)}  size ${String(row.sizeDeltaMb).padStart(8)} MB`,
      );
    }
    console.log("\nTop object name growth:");
    for (const row of singleOrDiff.topObjectGrowth.slice(0, 15)) {
      console.log(
        `  +${row.countDelta} (${row.sizeDeltaMb} MB)  ${row.name.slice(0, 90)}`,
      );
    }
    if (singleOrDiff.retainerHints.length > 0) {
      console.log("\nRetainer hints (name pattern match):");
      for (const row of singleOrDiff.retainerHints.slice(0, 12)) {
        console.log(`  +${row.countDelta}  ${row.name.slice(0, 90)}`);
      }
    }
    if (dominators?.length) {
      console.log("\nDominators-lite (1-hop incoming):");
      for (const row of dominators.slice(0, 10)) {
        console.log(`  ${row.object.slice(0, 60)} (+${row.countDelta})`);
        for (const ret of row.retainers) {
          console.log(`    <- ${ret.name} (${ret.count})`);
        }
      }
    }
  } else {
    console.log(`File: ${singleOrDiff.file}`);
    console.log(`Nodes: ${singleOrDiff.nodeCount}`);
    console.log(`Self-size total: ${singleOrDiff.totalMb} MB\n`);
    console.log("By type:");
    for (const row of singleOrDiff.byType.slice(0, 12)) {
      console.log(`  ${row.type.padEnd(16)} ${String(row.count).padStart(8)}  ${row.sizeMb} MB`);
    }
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const jsonOut = [...flags].find((f) => f.startsWith("--json="))?.slice(7);

  if (args.length < 1) {
    console.error(
      "Usage: node scripts/heap-snapshot-diff.mjs <before> [after] [--dominators-lite] [--json=path]",
    );
    process.exit(1);
  }

  const beforeLoaded = loadSnapshot(args[0]);
  let payload;

  if (args.length === 1) {
    payload = { mode: "single", analysis: analyze(beforeLoaded) };
    printReport(payload.analysis);
  } else {
    const afterLoaded = loadSnapshot(args[1]);
    const diff = diffSnapshots(beforeLoaded, afterLoaded);
    let dominators;
    if (flags.has("--dominators-lite")) {
      dominators = dominatorsLite(beforeLoaded, afterLoaded);
    }
    payload = { mode: "diff", diff, dominators };
    printReport(diff, dominators);
  }

  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nJSON: ${path.resolve(jsonOut)}`);
  }
}

main();
