import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parsePackageIndex, compareVersions, resolvePackages, prefixEntry, debMembers, tarEntries, createPackageManager } from '../package-manager.mjs';

function tar(name, text) {
  const data = Buffer.from(text); const header = Buffer.alloc(512);
  const field = (start, size, value) => header.write(value, start, size, 'ascii');
  field(0,100,name); field(100,8,'0000755\0'); field(124,12,data.length.toString(8).padStart(11,'0')+'\0');
  header.fill(32,148,156); field(156,1,'0'); field(257,6,'ustar\0');
  const checksum=[...header].reduce((a,b)=>a+b,0); field(148,8,checksum.toString(8).padStart(6,'0')+'\0 ');
  return Buffer.concat([header,data,Buffer.alloc((512-data.length%512)%512),Buffer.alloc(1024)]);
}
function deb(members) {
  const parts=[Buffer.from('!<arch>\n')];
  for (const [name,data] of members) {
    const header=(name+'/').padEnd(16)+'0'.padEnd(12)+'0'.padEnd(6)+'0'.padEnd(6)+'100644'.padEnd(8)+String(data.length).padEnd(10)+'`\n';
    parts.push(Buffer.from(header),data);if(data.length%2)parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}
function packageFixture(name='sample', content='#!/data/data/com.termux/files/usr/bin/bash\necho OK\n') {
  const archive=deb([['debian-binary',Buffer.from('2.0\n')],['control.tar.gz',gzipSync(tar('./control','Package: sample\n'))],['data.tar.gz',gzipSync(tar(`./data/data/com.termux/files/usr/bin/${name}`,content))]]);
  const index=`Package: ${name}\nVersion: 1.0\nArchitecture: aarch64\nFilename: pool/main/s/sample.deb\nSize: ${archive.length}\nSHA256: ${crypto.createHash('sha256').update(archive).digest('hex')}\n`;
  return { archive,index };
}
async function fixture(run) {
  const dir=await mkdtemp(path.join(tmpdir(),'pi-pkg-test-'));
  const prefix=path.join(dir,'usr'),stateDir=path.join(dir,'state'),baselineFile=path.join(dir,'baseline.json');
  await mkdir(prefix);await writeFile(baselineFile,'[]');
  try { await run({prefix,stateDir,baselineFile}); } finally { await rm(dir,{recursive:true,force:true}); }
}

test('Debian versions and dependencies do not silently upgrade existing runtime', () => {
  for (const [a,b,result] of [['1.0','1.0-0',0],['1.0~rc1','1.0',-1],['1:1','2.0',1],['1.0-10','1.0-2',1],['1.01','1.1',0]]) assert.equal(compareVersions(a,b),result);
  const index=parsePackageIndex('Package: sample\nArchitecture: aarch64\nVersion: 1\nDepends: base (>= 2)\n\nPackage: base\nArchitecture: aarch64\nVersion: 3\n');
  assert.throws(()=>resolvePackages(index,new Map([['base',{version:'1'}]]),'sample'),/without updating/);
  assert.equal(resolvePackages(index,new Map([['base',{version:'2'}]]),'sample').length,1);
  assert.throws(()=>resolvePackages(parsePackageIndex('Package: nodejs\nArchitecture: aarch64\nVersion: 26\n'),new Map(),'nodejs'),/bundled-runtime/);
});

test('archives reject traversal, unsafe links and bad tar checksums', () => {
  const pkg=packageFixture();assert.equal(debMembers(pkg.archive).size,3);
  assert.equal(tarEntries(tar('./control','test')).length,1);
  const bad=tar('./control','test');bad[0]=120;assert.throws(()=>tarEntries(bad),/checksum/);
  for (const name of ['../../escape','data/data/com.termux/files/usr/bin/../../escape','/etc/passwd']) assert.throws(()=>prefixEntry({name,type:'0'}));
  assert.throws(()=>prefixEntry({name:'data/data/com.termux/files/usr/bin/link',type:'2',link:'../..'}),/symlink/);
});

test('install verifies checksum, relocates shebang, records additions and prevents overwrite', async () => fixture(async (options) => {
  const pkg=packageFixture();
  const fetcher=async (url)=>new Response(url.endsWith('Packages.gz')?gzipSync(pkg.index):pkg.archive);
  const manager=createPackageManager({...options,fetcher});
  await manager.install('sample');
  assert.match(await readFile(path.join(options.prefix,'bin/sample'),'utf8'),new RegExp(options.prefix+'/bin/bash'));
  assert.equal((await manager.installed()).get('sample').version,'1.0');
  await manager.install('sample'); // no overwrites for already-installed packages
  const collision=packageFixture('existing');await writeFile(path.join(options.prefix,'bin/existing'),'KEEP');
  const other=createPackageManager({...options,fetcher:async (url)=>new Response(url.endsWith('Packages.gz')?gzipSync(collision.index):collision.archive)});
  await assert.rejects(other.install('existing'),/overwrite/);
  assert.equal(await readFile(path.join(options.prefix,'bin/existing'),'utf8'),'KEEP');
}));

test('corrupt package never writes files or installation record', async () => fixture(async (options) => {
  const pkg=packageFixture();const corrupted=Buffer.from(pkg.archive);corrupted[15]^=1;
  const manager=createPackageManager({...options,fetcher:async (url)=>new Response(url.endsWith('Packages.gz')?gzipSync(pkg.index):corrupted)});
  await assert.rejects(manager.install('sample'),/Checksum/);
  await assert.rejects(readFile(path.join(options.prefix,'bin/sample')));
  assert.equal((await manager.installed()).size,0);
}));
