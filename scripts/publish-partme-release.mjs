// Run only in the fork's manually dispatched publish job, after artifact staging.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
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
// Preserve assets once public. BUILD.json records the original upload job;
// later publish-only retries must not rewrite that provenance.
const publishedRelease=JSON.parse(run('gh',['api',`repos/partme-ai/codegraph/releases/tags/v${version}`]));
for(const file of [...archives,'SHA256SUMS','BUILD.json','install.sh','install.ps1','npm-pack-report.json']) {
 const asset=publishedRelease.assets.find(a=>a.name===file);
 if(asset) {
   assert.equal(asset.state,'uploaded');
   if(file==='BUILD.json') {
     const previous=JSON.parse(run('gh',['api',asset.url,'-H','Accept: application/octet-stream']));
     assert.equal(previous.version,version);assert.equal(previous.sourceCommit,build.head_sha);
     assert.equal(previous.buildRun,build.html_url);assert.deepEqual(previous.targets,targets);
   } else {
     const digest='sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path.join(release,file))).digest('hex');
     assert.equal(asset.digest,digest,`Published release asset differs: ${file}`);
   }
   console.log(`Preserved verified release asset: ${file}`);
 } else {
   run('gh',['release','upload','v'+version,path.join(release,file)],{stdio:'inherit'});
 }
}
function readPackage(name) {
 try {return JSON.parse(run('npm',['view',`${name}@${version}`,'--json','--prefer-online'],{stdio:['ignore','pipe','pipe']}));}
 catch(e) {if(!String(e.stderr).includes('E404'))throw e;return null;}
}
// Upload the platform batch first, then wait for all of it to become visible.
// Registry propagation has exceeded two minutes in this release. Waiting once
// per batch avoids repeatedly starting jobs or serializing that delay six times.
// The main launcher is withheld until all its optional dependencies are ready.
for (const batch of [reports.slice(0,-1),reports.slice(-1)]) {
 for (const p of batch) {
   const existing=readPackage(p.name);
   if(existing) {
     assert.equal(existing.version,version);
     assert.equal(existing.dist.integrity,p.integrity,`Existing package differs: ${p.name}`);
     console.log(`Already published and verified: ${p.name}@${version}`);
   } else {
     try {
       console.log(run('npm',['publish',path.join(out,p.filename),'--access','public','--tag','latest','--provenance','--loglevel=warn'],{stdio:['ignore','pipe','pipe']}));
     } catch(error) {
       // A prior successful upload may be immutable at the write endpoint
       // before registry reads can see it. Only this precise conflict can
       // proceed to readback; permission/authentication errors still fail.
       if(!String(error.stderr).includes('You cannot publish over the previously published versions'))throw error;
       console.log(`Registry already has an immutable version; awaiting integrity verification: ${p.name}@${version}`);
     }
   }
 }
 const pending=new Map(batch.map(p=>[p.name,p]));
 for(let attempt=0;attempt<=30 && pending.size;attempt++) {
   if(attempt>0)await delay(20000);
   for(const [name,p] of pending) {
     const actual=readPackage(name);
     if(!actual)continue;
     assert.equal(actual.version,version);
     assert.equal(actual.dist.integrity,p.integrity);
     if(actual['dist-tags']?.latest!==version)run('npm',['dist-tag','add',`${name}@${version}`,'latest'],{stdio:'inherit'});
     pending.delete(name);
     console.log(`Registry verified: ${name}@${version}`);
   }
   if(pending.size)console.log(`Waiting for registry visibility (${attempt}/30): ${[...pending.keys()].join(', ')}`);
 }
 assert.equal(pending.size,0,`Registry still lacks ${[...pending.keys()].join(', ')} after 10 minutes; inspect npm before retrying.`);
}
run('gh',['release','edit','v'+version,'--draft=false','--prerelease'],{stdio:'inherit'});
console.log('Published and registry-verified all seven packages and the GitHub prerelease.');
