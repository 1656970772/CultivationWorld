#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(root, path)).href);

const { loadGameConfigsFromManifest } = await imp('js/core/data-manifest-loader.js');
const { validateGameData } = await imp('js/core/game-data-validator.js');

const configs = await loadGameConfigsFromManifest(load('data/config/data-manifest.json'), {
  basePath: root,
  loadJson: load,
});

validateGameData(configs, { strict: true });
console.log('门派配置校验通过');
