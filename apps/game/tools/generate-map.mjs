import { writeFileSync } from 'fs';

const WIDTH = 300;
const HEIGHT = 300;
const SEED = 42;

// ───────────────────────── 连续噪声（value noise + 多 octave）─────────────────────────
// 与逐格独立随机不同，value noise 在格点处取随机值，格内用平滑插值，
// 使相邻格高度相关 → 地形成片成块，而非马赛克噪点。

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 0) / 0xffffffff;
}

function smooth(t) {
  // smoothstep，去掉线性插值的方块感
  return t * t * (3 - 2 * t);
}

/** 单层 value noise，频率 freq（格点间距 = 1/freq 个图格）*/
function valueNoise(x, y, freq, seed) {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);

  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);

  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** 多倍频分形噪声（fBm），值域约 [0,1] */
function fbm(x, y, seed, { octaves = 4, baseFreq = 1 / 40, lacunarity = 2, gain = 0.5 } = {}) {
  let amp = 1, freq = baseFreq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, freq, seed + o * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ───────────────────────── 地形分配 ─────────────────────────
// 三个连续场：海拔(elevation)、湿度(moisture)、灵气(spirit)。
// 由场的阈值组合决定地形，使山脉/森林/平原/沙漠/沼泽各自连成区域。

function getTerrain(x, y) {
  const elevation = fbm(x, y, SEED, { octaves: 5, baseFreq: 1 / 55 });
  const moisture = fbm(x, y, SEED + 5000, { octaves: 4, baseFreq: 1 / 70 });
  const spirit = fbm(x, y, SEED + 9000, { octaves: 3, baseFreq: 1 / 30 });

  // 区域性偏置：让北部更高（山脉带）、特定角落更干/更湿
  let elev = elevation;
  if (y < 60) elev += 0.22 * (1 - y / 60);          // 北部隆起为山脉
  let moist = moisture;
  if (x < 70 && y > 200) moist -= 0.28;             // 西南偏干 → 沙漠
  if (x > 200 && y > 200) {                          // 东南低洼湿地 → 沼泽
    moist += 0.30;
    elev -= 0.22;
  }

  // 河流：沿中部一条带状低洼（用噪声扰动河道，使其蜿蜒而非直线）
  const riverCenter = 140 + (valueNoise(x, 0, 1 / 50, SEED + 777) - 0.5) * 30;
  const riverDist = Math.abs(y - riverCenter);
  if (riverDist < 1.6) return 'river';

  // 灵脉：仅在灵气极高值的小斑块出现（成簇而非散点；顶级灵脉全图寥寥数处）
  if (spirit > 0.905) return 'top_spirit_vein';
  if (spirit > 0.86) return 'high_spirit_vein';
  if (spirit > 0.82) return 'mid_spirit_vein';
  if (spirit > 0.74) return 'low_spirit_vein';

  // 海拔/湿度组合 → 基础地形
  if (elev > 0.66) return 'mountain';
  if (elev < 0.34) {
    // 低地：看湿度
    if (moist < 0.28) return 'desert';
    if (moist > 0.66) return 'swamp';
    return 'plain';
  }
  // 中等海拔
  if (moist > 0.55) return 'forest';
  if (moist < 0.26) return 'desert';
  return 'plain';
}

console.log(`正在生成 ${WIDTH}x${HEIGHT} 地图（连续噪声 / 地形成片），共 ${WIDTH * HEIGHT} 格...`);

const tiles = [];
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    tiles.push({
      x,
      y,
      terrain: getTerrain(x, y),
      ownerId: null,
      resourceType: null,
      resourceAmount: 0,
      buildings: []
    });
  }
}

const stats = {};
for (const tile of tiles) stats[tile.terrain] = (stats[tile.terrain] || 0) + 1;
const total = tiles.length;
console.log('\n地形分布统计：');
for (const [terrain, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${terrain.padEnd(20)} ${count.toString().padStart(6)} 格  (${(count / total * 100).toFixed(1)}%)`);
}

const mapData = { width: WIDTH, height: HEIGHT, tiles };
const outputPath = 'apps/game/data/world/map.json';
writeFileSync(outputPath, JSON.stringify(mapData));

const fs = await import('fs');
const stat = fs.statSync(outputPath);
console.log(`\n已写入 ${outputPath}`);
console.log(`文件大小：${(stat.size / 1024 / 1024).toFixed(2)} MB (${stat.size} 字节)`);
console.log(`生成完成：${tiles.length} 格`);
