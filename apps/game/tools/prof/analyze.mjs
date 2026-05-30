import { readFileSync } from 'node:fs';
const profName = process.argv[2] || './sim.cpuprofile';
const prof = JSON.parse(readFileSync(new URL(profName, import.meta.url), 'utf-8'));
const { nodes, samples, timeDeltas } = prof;
const byId = new Map(nodes.map(n => [n.id, n]));
const selfTime = new Map();
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const dt = timeDeltas[i] || 0;
  selfTime.set(id, (selfTime.get(id) || 0) + dt);
}
const agg = new Map();
for (const [id, t] of selfTime) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').split('/').slice(-1)[0]}:${cf.lineNumber}`;
  agg.set(key, (agg.get(key) || 0) + t);
}
const total = [...selfTime.values()].reduce((a, b) => a + b, 0);
const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`总采样时间 ${(total / 1000).toFixed(0)}ms\n--- 自耗时 Top 25 ---`);
for (const [k, t] of sorted) {
  console.log(`${(t / 1000).toFixed(0).padStart(6)}ms ${((t / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
}
