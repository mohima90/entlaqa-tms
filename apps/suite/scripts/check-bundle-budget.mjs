// CI gate 9 (Development Plan §5.3): client bundle-size budget. Run after `next build`.
//
// The budget is per page (PO decision, 10 Oct 2026): the gzipped JavaScript a browser downloads to open
// each route — the shared framework chunks plus every chunk its layouts, page and synchronous client
// components need — must stay within `clientJsPerRouteGzipKiB`. Lazily loaded chunks (`async`) and the
// legacy-browser polyfills are not part of a first load and are not counted. The total of all chunks is
// printed for information only: it grows with every new screen even when no page gets heavier.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

const appDir = new URL('..', import.meta.url).pathname;
const nextDir = join(appDir, '.next');
const budget = JSON.parse(readFileSync(join(appDir, 'performance-budget.json'), 'utf8'));
const chunksDir = join(nextDir, 'static/chunks');
if (!existsSync(chunksDir)) {
  console.error('check-bundle-budget: .next/static/chunks not found — run `next build` first');
  process.exit(1);
}

const sizes = new Map();
/** Gzipped size in bytes of a file under .next (path like `static/chunks/x.js`). */
function gzipSize(path) {
  if (!sizes.has(path)) sizes.set(path, gzipSync(readFileSync(join(nextDir, path))).length);
  return sizes.get(path);
}

function gzipTotal(dir, ext) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(ext)) {
      total += gzipSync(readFileSync(join(entry.parentPath, entry.name))).length;
    }
  }
  return total / 1024;
}

/** `/_next/static/chunks/a.js` and `static/chunks/a.js` → `static/chunks/a.js`; other assets → null. */
function chunkPath(file) {
  const path = file.replace(/^\/?_next\//, '').replace(/^\//, '');
  return path.startsWith('static/') && path.endsWith('.js') ? path : null;
}

const buildManifest = JSON.parse(readFileSync(join(nextDir, 'build-manifest.json'), 'utf8'));
const shared = (buildManifest.rootMainFiles ?? []).map(chunkPath).filter(Boolean);

/** Every app route's client-reference manifest (one per page). */
function routeManifests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === 'page_client-reference-manifest.js') {
      found.push(join(entry.parentPath, entry.name));
    }
  }
  return found;
}

const serverAppDir = join(nextDir, 'server/app');
const manifests = existsSync(serverAppDir) ? routeManifests(serverAppDir) : [];
if (manifests.length === 0) {
  console.error(
    'check-bundle-budget: no page_client-reference-manifest.js found under .next/server/app',
  );
  process.exit(1);
}

const routes = [];
for (const file of manifests) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(file, 'utf8'), sandbox);
  for (const [route, manifest] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
    const files = new Set(shared);
    for (const list of Object.values(manifest.entryJSFiles ?? {})) {
      for (const f of list) {
        const p = chunkPath(f);
        if (p) files.add(p);
      }
    }
    for (const mod of Object.values(manifest.clientModules ?? {})) {
      if (mod.async) continue;
      for (const f of mod.chunks ?? []) {
        const p = chunkPath(f);
        if (p) files.add(p);
      }
    }
    const bytes = [...files].reduce((sum, p) => sum + gzipSize(p), 0);
    routes.push({ route: route || relative(serverAppDir, file), kib: bytes / 1024 });
  }
}
routes.sort((a, b) => b.kib - a.kib);

let failed = false;
const perRoute = budget.clientJsPerRouteGzipKiB;
for (const { route, kib } of routes) {
  const ok = kib <= perRoute;
  failed ||= !ok;
  if (!ok)
    console.error(
      `FAIL client JS (gzip) ${route}: ${kib.toFixed(1)} KiB (budget ${perRoute} KiB per page)`,
    );
}
const heaviest = routes[0];
console.error(
  `${failed ? 'FAIL' : 'ok  '} client JS per page (gzip): heaviest ${heaviest.route} ${heaviest.kib.toFixed(1)} KiB ` +
    `of ${routes.length} pages (budget ${perRoute} KiB per page)`,
);
for (const { route, kib } of routes.slice(0, 5))
  console.error(`       ${kib.toFixed(1).padStart(6)} KiB  ${route}`);

const css = gzipTotal(join(nextDir, 'static'), '.css');
const cssOk = css <= budget.cssGzipKiB;
failed ||= !cssOk;
console.error(
  `${cssOk ? 'ok  ' : 'FAIL'} CSS (gzip): ${css.toFixed(1)} KiB (budget ${budget.cssGzipKiB} KiB)`,
);
console.error(
  `info all client JS chunks together (gzip, not a budget): ${gzipTotal(chunksDir, '.js').toFixed(1)} KiB`,
);
process.exit(failed ? 1 : 0);
