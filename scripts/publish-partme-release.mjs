// Run only in the fork's manually dispatched publish job, after artifact staging.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const version = '1.6.0-zig';
const targets = ['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64'];
const root = process.cwd(), release = path.join(root, 'release');
const run = (bin,args,opts={}) => execFileSync(bin,args,{encoding:'utf8',...opts});
if (process.env.GITHUB_REPOSITORY !== 'partme-ai/codegraph' || !process.env.NODE_AUTH_TOKEN) throw new Error('Fork publish job and NPM_TOKEN required');
const build = JSON.parse(run('gh',['api',`repos/partme-ai/codegraph/actions/runs/${process.env.ARTIFACT_RUN}`]));
assert.equal(build.conclusion,'success'); assert.equal(build.name,'PartMe release build');
assert.equal(build.head_sha,'1408a883265172a90a52fabd1ba2adfe6287a3eb');
const validation = JSON.parse(run('gh',['api','repos/partme-ai/codegraph/actions/runs/36454692937']));
assert.equal(validation.conclusion,'success'); assert.equal(validation.head_sha,build.head_sha);
const reports=[];
const out=path.join(release,'npm-tarballs');fs.mkdirSync(out,{recursive:true});
for (const dir of [...targets.map(t=>'codegraph-'+t),'main']) {
 const cwd=path.join(release,'npm',dir),pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8'));
 assert.equal(pkg.name,dir==='main'?'@partme.ai/codegraph':'@partme.ai/'+dir);assert.equal(pkg.version,version);
 assert.equal(pkg.repository.url,'git+https://github.com/partme-ai/codegraph.git');
 assert.ok(fs.existsSync(path.join(cwd,'LICENSE')));
 if(dir==='main') {assert.deepEqual(Object.keys(pkg.optionalDependencies).sort(),targets.map(t=>'@partme.ai/codegraph-'+t).sort());for(const v of Object.values(pkg.optionalDependencies))assert.equal(v,version);}
 else {assert.ok(fs.existsSync(path.join(cwd,'lib/kernel/codegraph-kernel.node'))); const inner=JSON.parse(fs.readFileSync(path.join(cwd,'lib/package.json'),'utf8'));assert.equal(inner.name,'@partme.ai/codegraph');assert.equal(inner.version,version);}
 const packed=JSON.parse(run('npm',['pack','--json','--pack-destination',out],{cwd}))[0];
 assert.ok(packed.files.some(f=>f.path==='LICENSE'));
 reports.push({name:pkg.name,version,filename:packed.filename,integrity:packed.integrity,shasum:packed.shasum,size:packed.size});
}
fs.writeFileSync(path.join(release,'npm-pack-report.json'),JSON.stringify(reports,null,2)+'\n');
const archives=targets.map(t=>`codegraph-${t}${t.startsWith('win32')?'.zip':'.tar.gz'}`);
fs.writeFileSync(path.join(release,'SHA256SUMS'),archives.map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(release,f))).digest('hex')+'  '+f).join('\n')+'\n');
fs.copyFileSync('install.sh',path.join(release,'install.sh'));fs.copyFileSync('install.ps1',path.join(release,'install.ps1'));
fs.writeFileSync(path.join(release,'BUILD.json'),JSON.stringify({version,package:'@partme.ai/codegraph',sourceCommit:build.head_sha,releaseCommit:'480d848812a73b69afb274ea90cd8f197c8d0c52',buildRun:build.html_url,publishRun:`https://github.com/partme-ai/codegraph/actions/runs/${process.env.GITHUB_RUN_ID}`,validationRun:validation.html_url,targets},null,2)+'\n');
// Finish the draft's assets before exposing the main npm launcher. Uploading
// identical artifacts is safe to retry; no compilation happens in this job.
run('gh',['release','upload','v'+version,...[...archives,'SHA256SUMS','BUILD.json','install.sh','install.ps1','npm-pack-report.json'].map(f=>path.join(release,f)),'--clobber'],{stdio:'inherit'});
for (const p of reports) {
 let existing;
 try {existing=JSON.parse(run('npm',['view',`${p.name}@${version}`,'--json'],{stdio:['ignore','pipe','pipe']}));}
 catch(e) {if(!String(e.stderr).includes('E404'))throw e;}
 if(existing) {
   assert.equal(existing.version,version);
   assert.equal(existing.dist.integrity,p.integrity,`Existing package differs: ${p.name}`);
   console.log(`Already published and verified: ${p.name}@${version}`);
 } else {
   run('npm',['publish',path.join(out,p.filename),'--access','public','--tag','latest','--provenance'],{stdio:'inherit'});
 }
 const actual=JSON.parse(run('npm',['view',`${p.name}@${version}`,'--json']));
 assert.equal(actual.dist.integrity,p.integrity);
 if(actual['dist-tags']?.latest!==version)run('npm',['dist-tag','add',`${p.name}@${version}`,'latest'],{stdio:'inherit'});
}
run('gh',['release','edit','v'+version,'--draft=false','--prerelease'],{stdio:'inherit'});
console.log('Published and registry-verified all seven packages and the GitHub prerelease.');
