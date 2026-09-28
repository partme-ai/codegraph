#!/usr/bin/env node
// Fork-only release staging. Never run against the contribution checkout.
import fs from 'node:fs';
import path from 'node:path';

if (process.env.CODEGRAPH_RELEASE_STAGE !== '1' || !process.argv[2]) {
  throw new Error('Pass a disposable checkout and set CODEGRAPH_RELEASE_STAGE=1');
}
const root = path.resolve(process.argv[2]);
const version = '1.6.0-zig';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
function replace(file, from, to) {
  const source = read(file);
  if (!source.includes(from)) throw new Error(`Release transform no longer matches ${file}: ${from}`);
  write(file, source.replaceAll(from, to));
}
const pkg = JSON.parse(read('package.json'));
if (pkg.name !== '@colbymchenry/codegraph' || pkg.version !== '1.6.0') {
  throw new Error('Expected the reviewed upstream package identity/version');
}
pkg.name = '@partme.ai/codegraph';
pkg.version = version;
pkg.repository.url = 'git+https://github.com/partme-ai/codegraph.git';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(read('package-lock.json'));
lock.name = pkg.name; lock.version = version;
lock.packages[''].name = pkg.name; lock.packages[''].version = version;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

for (const file of ['scripts/npm-shim.js', 'scripts/npm-sdk.js', 'scripts/pack-npm.sh',
  'src/upgrade/index.ts', 'src/installer/index.ts', 'src/bin/codegraph.ts', 'install.sh', 'install.ps1',
  '__tests__/npm-shim.test.ts', '__tests__/npm-sdk.test.ts', '__tests__/upgrade.test.ts']) {
  replace(file, '@colbymchenry', '@partme.ai');
  const source = read(file);
  if (source.includes('colbymchenry/codegraph')) write(file, source.replaceAll('colbymchenry/codegraph', 'partme-ai/codegraph'));
}
// A prerelease is excluded by GitHub's /releases/latest endpoint. npm latest
// is the explicit fork channel and does include this release.
replace('src/upgrade/index.ts',
  'export async function resolveLatestVersion(repo = REPO, timeoutMs = 12000): Promise<string> {',
  `export async function resolveLatestVersion(repo = REPO, timeoutMs = 12000): Promise<string> {
  if (repo === REPO) {
    const response = await httpsGet('https://registry.npmjs.org/@partme.ai%2fcodegraph/latest', { 'User-Agent': 'codegraph-upgrade' }, timeoutMs);
    const version = JSON.parse(response.body)?.version;
    if (response.status !== 200 || typeof version !== 'string' || !parseSemver(version)) throw new Error('Could not resolve the PartMe npm release');
    return normalizeVersion(version);
  }`);
replace('src/upgrade/index.ts',
  'const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;',
  'const RAW_BASE = `https://github.com/${REPO}/releases/download/v1.6.0-zig`;');
// The shell installer is a release asset, so upgrades never fetch main's
// upstream-default installer. Pin its default to this prerelease.
replace('install.sh', 'REPO="partme-ai/codegraph"', 'REPO="partme-ai/codegraph"\nCODEGRAPH_VERSION="${CODEGRAPH_VERSION:-v1.6.0-zig}"');
replace('install.ps1', "$repo = 'partme-ai/codegraph'", "$repo = 'partme-ai/codegraph'\nif (-not $env:CODEGRAPH_VERSION) { $env:CODEGRAPH_VERSION = 'v1.6.0-zig' }");
replace('scripts/npm-shim.js', "'/main/install.sh | sh\\n'", "'/releases/download/v1.6.0-zig/install.sh | sh\\n'");
replace('scripts/npm-shim.js', 'https://raw.githubusercontent.com/', 'https://github.com/');
// Preserve the upstream MIT notice in every published package/archive.
replace('scripts/build-bundle.sh', 'cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/lib/"',
  'cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/lib/"\ncp "$ROOT/LICENSE" "$STAGE/LICENSE"\ncp "$ROOT/LICENSE" "$STAGE/lib/LICENSE"');
replace('scripts/pack-npm.sh', 'files: [process.env.NODEFILE, "lib", "bin"]', 'files: [process.env.NODEFILE, "lib", "bin", "LICENSE"]');
replace('scripts/pack-npm.sh', 'cp "$ROOT/scripts/npm-shim.js" "$NPM/main/npm-shim.js"', 'cp "$ROOT/LICENSE" "$NPM/main/LICENSE"\ncp "$ROOT/scripts/npm-shim.js" "$NPM/main/npm-shim.js"');
replace('scripts/pack-npm.sh', '"npm-sdk.js","dist","README.md"', '"npm-sdk.js","dist","README.md","LICENSE"');
write('README.md', `# @partme.ai/codegraph\n\nZig-enabled fork of [CodeGraph](https://github.com/colbymchenry/codegraph), released by PartMe under the original MIT license.\n\n\`npx @partme.ai/codegraph@${version} --version\`\n\nThe CLI bundles Node and the matching native kernel for macOS, Linux and Windows (x64/arm64). Zig indexing uses the audited WASM grammar.\n\nUse \`npx @partme.ai/codegraph\` to configure your agent, then \`npx @partme.ai/codegraph init\` inside a project. The library entry is \`require('@partme.ai/codegraph')\` (requires a supported host Node with node:sqlite).\n\n[Source and audit](https://github.com/partme-ai/codegraph/tree/v${version}) · [Release](https://github.com/partme-ai/codegraph/releases/tag/v${version})\n\nThis prerelease satisfies the documented static-indexing acceptance contract; it is not a complete Zig compiler or evaluator.\n`);
console.log(`Staged ${pkg.name}@${version} in ${root}`);
