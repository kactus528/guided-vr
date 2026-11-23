// Builds the GitHub Pages site in docs/: bundles the app (Three.js kept external),
// copies Three.js itself next to it (no CDN, works offline), the public/ assets,
// and an index.html that points at the bundle.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const esbuild = process.env.ESBUILD ?? 'node_modules/.bin/esbuild';
const three = process.env.THREE_MODULE ?? 'node_modules/three/build/three.module.js';

mkdirSync('docs', { recursive: true });
execFileSync(esbuild, [
  'src/main.ts', '--bundle', '--format=esm', '--target=es2022', '--external:three',
  '--define:import.meta.env.PROD=true', '--minify', '--sourcemap', '--outfile=docs/app.js', '--log-level=warning',
], { stdio: 'inherit' });
copyFileSync(three, 'docs/three.module.js');
for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `docs/${f}`);
writeFileSync('docs/.nojekyll', '');
const html = readFileSync('index.html', 'utf8').replace('src="./src/main.ts"', `src="./app.js?v=${createHash('sha1').update(readFileSync('docs/app.js')).digest('hex').slice(0, 10)}"`)
  .replace(/\s*<!-- pages-redirect -->[\s\S]*?<!-- \/pages-redirect -->/, '');
writeFileSync('docs/index.html', html);
console.log('docs/ built');
