import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it('stages fork identity without changing the contribution checkout', () => {
  const root = path.resolve(__dirname, '..');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-partme-stage-'));
  try {
    for (const name of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'install.sh', 'install.ps1', 'scripts', 'src', '__tests__']) {
      fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
    }
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-partme-release.mjs'), stage], {
      encoding: 'utf8', env: { ...process.env, CODEGRAPH_RELEASE_STAGE: '1' },
    });
    expect(result.status, result.stderr).toBe(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@partme.ai/codegraph');
    expect(pkg.version).toBe('1.6.0-zig');
    expect(pkg.repository.url).toBe('git+https://github.com/partme-ai/codegraph.git');
    for (const file of ['scripts/npm-shim.js', 'scripts/npm-sdk.js', 'scripts/pack-npm.sh', 'src/upgrade/index.ts', 'src/installer/index.ts']) {
      const source = fs.readFileSync(path.join(stage, file), 'utf8');
      expect(source).not.toContain('@colbymchenry');
      expect(source).toContain('@partme.ai');
    }
    expect(fs.readFileSync(path.join(stage, 'src/upgrade/index.ts'), 'utf8')).toContain('registry.npmjs.org/@partme.ai%2fcodegraph/latest');
    expect(fs.readFileSync(path.join(stage, 'scripts/pack-npm.sh'), 'utf8')).toContain('LICENSE');
    expect(fs.readFileSync(path.join(stage, 'LICENSE'), 'utf8')).toBe(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'));
    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name).toBe('@colbymchenry/codegraph');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}, 30000);
