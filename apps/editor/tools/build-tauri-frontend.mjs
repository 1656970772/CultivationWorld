import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const editorDir = process.cwd();
const distDir = path.join(editorDir, 'desktop-dist');

const entriesToCopy = [
  'data-editor.html',
  'css',
  'js',
  'data'
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of entriesToCopy) {
  await cp(path.join(editorDir, entry), path.join(distDir, entry), {
    recursive: true,
    force: true
  });
}

console.log(`Tauri editor assets copied to ${path.relative(editorDir, distDir)}`);
