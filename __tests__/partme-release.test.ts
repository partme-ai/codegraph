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
    const readme = fs.readFileSync(path.join(stage, 'README.md'), 'utf8');
    for (const heading of ['## CLI Reference', '## MCP Tools', '## Library Usage', '## Configuration']) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('npx @partme.ai/codegraph');
    expect(readme).not.toContain('npx @colbymchenry/codegraph');
    expect(readme).not.toContain('SLSA v1.0 Build Level 2');

    // Exercise the actual archive -> npm-package path, not script literals.
    const bundle = path.join(stage, 'bundle/codegraph-darwin-arm64');
    fs.mkdirSync(path.join(bundle, 'lib'), { recursive: true });
    fs.cpSync(path.join(root, 'dist'), path.join(bundle, 'lib/dist'), { recursive: true });
    fs.cpSync(path.join(root, 'LICENSE'), path.join(bundle, 'LICENSE'));
    fs.writeFileSync(path.join(bundle, 'node'), 'fixture runtime');
    fs.mkdirSync(path.join(stage, 'release'), { recursive: true });
    fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'dist/index.d.ts'), 'export {};\n');
    const archive = spawnSync('tar', ['-czf', path.join(stage, 'release/codegraph-darwin-arm64.tar.gz'), '-C', path.join(stage, 'bundle'), 'codegraph-darwin-arm64'], { encoding: 'utf8' });
    expect(archive.status, archive.stderr).toBe(0);
    const assembled = spawnSync('bash', [path.join(stage, 'scripts/pack-npm.sh')], { encoding: 'utf8' });
    expect(assembled.status, assembled.stderr).toBe(0);
    for (const name of ['main', 'codegraph-darwin-arm64']) {
      const cwd = path.join(stage, 'release/npm', name);
      expect(fs.readFileSync(path.join(cwd, 'README.md'), 'utf8')).toContain('## CLI Reference');
      const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
      expect(packed.status, packed.stderr).toBe(0);
      expect(JSON.parse(packed.stdout)[0].files.some((file: { path: string }) => file.path === 'README.md')).toBe(true);
    }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}, 30000);
