#!/usr/bin/env node
/**
 * JPS 正确性 + 性能对照测试：与标准 A* 比较路径代价是否一致、统计耗时。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const map = load('data/world/map.json');
const terrains = load('data/definitions/terrains.json');

const tileIndex = new Map();
for (const t of map.tiles) tileIndex.set(`${t.x},${t.y}`, t);
const terrainIndex = new Map();
for (const t of terrains) terrainIndex.set(t.type, t);

const { GridGraph } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/grid-graph.js')).href);
const { computePath } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/pathfinding.js')).href);
const { jpsPath } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/jps.js')).href);
const { jpsPlusPath, JpsPlusData } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/jps-plus.js')).href);
const { HierarchicalGraph } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world/hierarchical-graph.js')).href);

const graph = new GridGraph({ tileIndex, terrainIndex, width: map.width, height: map.height });
let tJpp0 = performance.now();
const jpp = new JpsPlusData(graph);
console.log(`JPS+ 预处理: ${(performance.now() - tJpp0).toFixed(0)}ms`);
let tHier0 = performance.now();
const hier = new HierarchicalGraph({ graph, clusterSize: 16 });
console.log(`HPA* 预处理: ${(performance.now() - tHier0).toFixed(0)}ms, 抽象节点 ${hier.nodes.size}`);

function pathCost(path) {
  let c = 0;
  for (const p of path) c += graph.costAt(p.x, p.y);
  return c;
}
function randWalkable() {
  for (let i = 0; i < 1000; i++) {
    const x = Math.floor(Math.random() * map.width);
    const y = Math.floor(Math.random() * map.height);
    if (graph.isWalkable(x, y)) return { x, y };
  }
  return { x: 0, y: 0 };
}

const N = 500;
const cases = [];
for (let i = 0; i < N; i++) cases.push([randWalkable(), randWalkable()]);

let mismatches = 0, jpsReach = 0, astarReach = 0, costDiffSum = 0, maxDiff = 0;
let tA = 0, tJ = 0, tH = 0, hReach = 0, hCostDiffSum = 0;
let tP = 0, ppReach = 0, ppMismatch = 0, ppCostDiffSum = 0, ppMaxDiff = 0;

for (const [from, to] of cases) {
  let s = performance.now();
  const aPath = computePath(from, to, tileIndex, { terrainIndex }); // 标准 A*
  tA += performance.now() - s;

  s = performance.now();
  const jPath = jpsPath(from, to, graph, {}); // JPS
  tJ += performance.now() - s;

  s = performance.now();
  const pPath = jpsPlusPath(from, to, graph, jpp, {}); // JPS+
  tP += performance.now() - s;
  if (pPath !== null) ppReach++;
  if ((jPath === null) !== (pPath === null)) {
    ppMismatch++;
    if (ppMismatch <= 5) console.log(`JPS+ 与 JPS 可达性不一致: ${JSON.stringify(from)}->${JSON.stringify(to)} JPS=${jPath !== null} JPS+=${pPath !== null}`);
  } else if (jPath && pPath) {
    const d = Math.abs(pathCost(pPath) - pathCost(jPath));
    ppCostDiffSum += d;
    if (d > ppMaxDiff) ppMaxDiff = d;
  }

  // HPA*（分层），同簇会返回 null，回退 JPS
  s = performance.now();
  let hPath = hier.findPath(from, to);
  if (hPath === null) hPath = jPath; // 同簇等回退
  tH += performance.now() - s;
  if (hPath !== null) {
    hReach++;
    if (aPath) { let ch = 0; for (const p of hPath) ch += graph.costAt(p.x, p.y); hCostDiffSum += Math.abs(ch - pathCost(aPath)); }
  }

  const aReach = aPath && aPath.length >= 0 && aPath !== null;
  const jReach = jPath !== null;
  if (aPath !== null) astarReach++;
  if (jReach) jpsReach++;

  if ((aPath === null) !== (jPath === null)) {
    mismatches++;
    if (mismatches <= 5) console.log(`可达性不一致: ${JSON.stringify(from)}->${JSON.stringify(to)} A*=${aPath !== null} JPS=${jReach}`);
    continue;
  }
  if (aPath && jPath) {
    const ca = pathCost(aPath), cj = pathCost(jPath);
    const diff = cj - ca;
    costDiffSum += Math.abs(diff);
    if (Math.abs(diff) > maxDiff) maxDiff = Math.abs(diff);
    if (diff !== 0 && Math.abs(diff) > ca * 0.02) {
      if (mismatches <= 5) console.log(`代价偏差>2%: ${JSON.stringify(from)}->${JSON.stringify(to)} A*=${ca} JPS=${cj}`);
    }
  }
}

console.log(`\n用例 ${N}`);
console.log(`可达数: A*=${astarReach} JPS=${jpsReach} | 可达性不一致 ${mismatches}`);
console.log(`代价绝对偏差总和 ${costDiffSum}, 最大单次偏差 ${maxDiff}（沼泽非均匀代价导致的微小偏差属正常）`);
console.log(`耗时: 标准A* ${tA.toFixed(0)}ms (${(tA / N).toFixed(2)}ms/次) | JPS ${tJ.toFixed(0)}ms (${(tJ / N).toFixed(2)}ms/次) | 加速 ${(tA / tJ).toFixed(1)}x`);
console.log(`JPS+: ${tP.toFixed(0)}ms (${(tP / N).toFixed(2)}ms/次) | 相对A*加速 ${(tA / tP).toFixed(1)}x | 相对JPS加速 ${(tJ / tP).toFixed(1)}x | 可达 ${ppReach}`);
console.log(`JPS+ vs JPS: 可达性不一致 ${ppMismatch} | 代价偏差总和 ${ppCostDiffSum} | 最大单次偏差 ${ppMaxDiff}`);
console.log(`HPA*: ${tH.toFixed(0)}ms (${(tH / N).toFixed(2)}ms/次) | 加速 ${(tA / tH).toFixed(1)}x | 可达 ${hReach} | 相对A*代价偏差均值 ${(hCostDiffSum / hReach).toFixed(1)}`);
