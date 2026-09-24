// PROTOTYPE — Option A post-build step: make a Next static export load from file://.
// Rewrites absolute /_next/static/ asset refs to ./_next/static/ and the Turbopack
// chunk base path. Only the ROOT page is valid after this (relative to out/).
// usage: node rewrite-a.mjs <exportDir>
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let files = 0, hits = 0;
for (const f of walk(dir)) {
  if (!/\.(html|txt|js)$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  let out = src.replace(/(["'(]|\\")\/_next\/static\//g, (_, q) => (hits++, q + './_next/static/'));
  out = out.replace(/TURBOPACK_CHUNK_BASE_PATH:"\/_next\/"/g, () => (hits++, 'TURBOPACK_CHUNK_BASE_PATH:"./_next/"'));
  if (out !== src) { writeFileSync(f, out); files++; }
}
console.log(`rewrite-a: ${hits} refs in ${files} files`);
