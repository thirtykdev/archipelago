// Build single-file executables of Atoll for macOS, Linux and Windows with Node's single executable application
// support. Steps: bundle the CLI with esbuild, generate the SEA blob with a Node of the target version, inject it
// into a downloaded Node binary per platform, sign ad hoc on macOS. Output: dist/atoll-<os>-<arch>[.exe].
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const NODE = process.env.ATOLL_NODE_VERSION ?? '22.12.0';
const TARGETS = (process.env.ATOLL_TARGETS ?? 'darwin-arm64,darwin-x64,linux-x64,linux-arm64,win-x64').split(',');
const ROOT = process.cwd(); const BUILD = join(ROOT, 'build'); const DIST = join(ROOT, 'dist'); const CACHE = join(ROOT, 'build', 'node-cache');
mkdirSync(BUILD, { recursive: true }); mkdirSync(DIST, { recursive: true }); mkdirSync(CACHE, { recursive: true });
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

console.log('1. bundling');
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), ['apps/cli/src/main.ts', '--bundle', '--platform=node', '--target=node22', '--format=cjs', `--outfile=${join(BUILD, 'atoll.cjs')}`, '--define:process.env.ATOLL_VERSION=' + JSON.stringify(version), '--log-level=warning'], { stdio: 'inherit' });

const assets = { 'index.html': 'apps/edge/static/index.html', 'app.css': 'apps/edge/static/app.css', 'app.js': 'apps/edge/static/app.js', 'mark.svg': 'apps/edge/static/mark.svg' };
writeFileSync(join(BUILD, 'sea-config.json'), JSON.stringify({ main: join(BUILD, 'atoll.cjs'), output: join(BUILD, 'sea.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, join(ROOT, v)])) }, null, 2));

async function fetchNode(target) {
  const [os, arch] = target.split('-');
  const isWin = os === 'win';
  const name = `node-v${NODE}-${os}-${arch}`;
  const bin = join(CACHE, isWin ? `${name}.exe` : `${name}.bin`);
  if (existsSync(bin)) return bin;
  const url = isWin ? `https://nodejs.org/dist/v${NODE}/${name}.zip` : `https://nodejs.org/dist/v${NODE}/${name}.tar.gz`;
  console.log(`   downloading ${url}`);
  const res = await fetch(url); if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  const archive = join(CACHE, isWin ? `${name}.zip` : `${name}.tar.gz`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  if (isWin) { execFileSync('unzip', ['-o', '-q', archive, `${name}/node.exe`, '-d', CACHE]); copyFileSync(join(CACHE, name, 'node.exe'), bin); }
  else { execFileSync('tar', ['-xzf', archive, '-C', CACHE, `${name}/bin/node`]); copyFileSync(join(CACHE, name, 'bin', 'node'), bin); chmodSync(bin, 0o755); }
  return bin;
}

console.log('2. generating the blob with the target Node version');
const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const hostNode = await fetchNode(hostTarget);
execFileSync(hostNode, ['--experimental-sea-config', join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

console.log('3. injecting into each platform binary');
for (const t of TARGETS) {
  const [os] = t.split('-'); const isWin = os === 'win';
  const src = await fetchNode(t);
  const out = join(DIST, `atoll-${t}${isWin ? '.exe' : ''}`);
  copyFileSync(src, out); if (!isWin) chmodSync(out, 0o755);
  if (os === 'darwin') spawnSync('codesign', ['--remove-signature', out], { stdio: 'ignore' });
  const args = [join(ROOT, 'node_modules/postject/dist/cli.js'), out, 'NODE_SEA_BLOB', join(BUILD, 'sea.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(os === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])];
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  if (os === 'darwin') { const r = spawnSync('codesign', ['--sign', '-', out], { stdio: 'inherit' }); if (r.status !== 0) console.warn('   codesign failed; the binary may be refused by Gatekeeper'); }
  console.log(`   ${out}`);
}
writeFileSync(join(DIST, 'README.txt'), `Atoll ${version} · lab preview · Archipelago (https://www.archipelago-project.org)

One file per platform. No installer, no service, nothing phones home.

macOS:    chmod +x atoll-darwin-arm64 && ./atoll-darwin-arm64
          (first run: right-click > Open, or: xattr -d com.apple.quarantine atoll-darwin-arm64)
Linux:    chmod +x atoll-linux-x64 && ./atoll-linux-x64
Windows:  double-click atoll-win-x64.exe (SmartScreen will warn: the file is not code-signed yet; choose More info > Run anyway)

It opens http://127.0.0.1:2865 in your browser and walks you through setup. Data lives in your user application
folder (shown on the setup screen). Delete that folder to remove everything.

Try discovery with no hardware:  ./atoll-darwin-arm64 serve --installed --lab-device --open
`);
console.log('done');
