import { readFile, writeFile, mkdir, open, rename, unlink, lstat, symlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const BASE = 'https://packages.termux.dev/apt/termux-main/';
const TERMUX_PREFIX = 'data/data/com.termux/files/usr';
const MAX_ARCHIVE = 256 * 1024 * 1024;
const protectedPackages = new Set(['apt', 'dpkg', 'nodejs', 'nodejs-lts', 'npm', 'termux-exec', 'termux-tools', 'termux-core']);

export function parsePackageIndex(text) {
  const packages = new Map();
  for (const paragraph of text.split(/\n\s*\n/)) {
    const fields = {};
    for (const line of paragraph.split('\n')) {
      const match = line.match(/^([\w-]+): (.*)$/);
      if (match) fields[match[1]] = match[2];
    }
    if (fields.Package && ['aarch64', 'all'].includes(fields.Architecture)) packages.set(fields.Package, fields);
  }
  return packages;
}

// Debian version ordering: epoch, upstream, revision, with '~' before everything.
export function compareVersions(left, right) {
  function split(version) {
    const colon = version.indexOf(':');
    const epoch = colon < 0 ? 0 : Number(version.slice(0, colon));
    const rest = colon < 0 ? version : version.slice(colon + 1);
    const dash = rest.lastIndexOf('-');
    return [epoch, dash < 0 ? rest : rest.slice(0, dash), dash < 0 ? '0' : rest.slice(dash + 1)];
  }
  function part(a, b) {
    let i = 0, j = 0;
    const digit = (c) => c !== undefined && /[0-9]/.test(c);
    const order = (c) => c === '~' ? -1 : c === undefined || digit(c) ? 0 : /[a-zA-Z]/.test(c) ? c.charCodeAt(0) : c.charCodeAt(0) + 256;
    while (i < a.length || j < b.length) {
      while ((i < a.length && !digit(a[i])) || (j < b.length && !digit(b[j]))) {
        const difference = order(a[i]) - order(b[j]);
        if (difference) return Math.sign(difference);
        if (i < a.length) i++;
        if (j < b.length) j++;
      }
      while (a[i] === '0') i++;
      while (b[j] === '0') j++;
      let aa = '', bb = '';
      while (digit(a[i])) aa += a[i++];
      while (digit(b[j])) bb += b[j++];
      if (aa.length !== bb.length) return Math.sign(aa.length - bb.length);
      if (aa !== bb) return aa < bb ? -1 : 1;
    }
    return 0;
  }
  const a = split(left), b = split(right);
  return Math.sign(a[0] - b[0]) || part(a[1], b[1]) || part(a[2], b[2]);
}
function satisfies(version, operator, required) {
  if (!operator) return true;
  const comparison = compareVersions(version, required);
  return { '=': comparison === 0, '>=': comparison >= 0, '<=': comparison <= 0, '>>': comparison > 0, '<<': comparison < 0 }[operator];
}

export function resolvePackages(index, installed, name) {
  if (!/^[a-z0-9][a-z0-9+.-]*$/.test(name)) throw new Error('Invalid package name.');
  const selected = new Map();
  function resolve(expression) {
    for (const alternative of expression.split('|')) {
      const match = alternative.trim().match(/^([a-z0-9][a-z0-9+.-]*)(?::\w+)?(?:\s*\((<<|<=|=|>=|>>)\s*([^\)]+)\))?$/);
      if (!match) throw new Error(`Unsupported dependency: ${expression}`);
      const [, dependency, operator, version] = match;
      const present = installed.get(dependency);
      if (present && satisfies(present.version, operator, version)) return;
      if (present) continue; // Never upgrade bundled or already installed packages.
      const pkg = index.get(dependency);
      if (!pkg || !satisfies(pkg.Version, operator, version)) continue;
      if (protectedPackages.has(dependency)) throw new Error(`${dependency} requires a bundled-runtime update; it cannot be installed here.`);
      if (selected.has(dependency)) return;
      selected.set(dependency, pkg);
      for (const field of ['Pre-Depends', 'Depends']) {
        for (const item of (pkg[field] || '').split(',')) if (item.trim()) resolve(item);
      }
      return;
    }
    throw new Error(`Cannot satisfy ${expression} without updating the runtime. Virtual packages are not supported.`);
  }
  resolve(name);
  return [...selected.values()];
}

export function debMembers(buffer) {
  if (buffer.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Invalid Debian archive.');
  const result = new Map();
  for (let offset = 8; offset < buffer.length;) {
    const header = buffer.subarray(offset, offset + 60);
    const size = Number(header.subarray(48, 58).toString().trim());
    if (header.length !== 60 || header.subarray(58).toString() !== '`\n' || !Number.isSafeInteger(size) || size < 0 || offset + 60 + size > buffer.length) throw new Error('Invalid archive member.');
    const name = header.subarray(0, 16).toString().trim().replace(/\/$/, '');
    result.set(name, buffer.subarray(offset + 60, offset + 60 + size));
    offset += 60 + size + size % 2;
  }
  return result;
}

export function tarEntries(buffer) {
  const result = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start, size) => header.subarray(start, start + size).toString().split('\0')[0];
    const octal = (start, size) => parseInt(string(start, size).trim() || '0', 8);
    const sum = [...header].reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    if (sum !== octal(148, 8)) throw new Error('Invalid tar checksum.');
    const size = octal(124, 12);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > buffer.length) throw new Error('Invalid tar size.');
    const prefix = string(345, 155);
    const name = (prefix ? prefix + '/' : '') + string(0, 100);
    const type = string(156, 1) || '0';
    if (!['0', '2', '5'].includes(type)) throw new Error(`Unsupported tar entry type ${type}; this package cannot be installed safely.`);
    result.push({ name, type, mode: octal(100, 8) & 0o777, link: string(157, 100), data: buffer.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

export function prefixEntry(entry) {
  const normalized = entry.name.replace(/^\.\//, '').replace(/\/$/, '');
  if (['.', '', 'data', 'data/data', 'data/data/com.termux', 'data/data/com.termux/files', TERMUX_PREFIX].includes(normalized)) return null;
  if (!normalized.startsWith(TERMUX_PREFIX + '/')) throw new Error('Package writes outside the Termux prefix.');
  const relative = normalized.slice(TERMUX_PREFIX.length + 1);
  if (relative.split('/').some((part) => !part || part === '..' || part === '.')) throw new Error('Unsafe package path.');
  let link = entry.link;
  if (entry.type === '2') {
    if (link.startsWith('/' + TERMUX_PREFIX + '/')) link = path.posix.relative(path.posix.dirname(relative), link.slice(TERMUX_PREFIX.length + 2));
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), link));
    if (!link || path.posix.isAbsolute(link) || resolved === '..' || resolved.startsWith('../')) throw new Error('Unsafe package symlink.');
  }
  return { ...entry, relative, link };
}

async function decompress(name, data, prefix) {
  if (name.endsWith('.gz')) return gunzipSync(data, { maxOutputLength: MAX_ARCHIVE });
  if (name.endsWith('.tar')) return data;
  if (!name.endsWith('.xz')) throw new Error('Unsupported package compression.');
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(prefix, 'bin/xz'), ['-dc'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Decompression timed out.')); }, 60_000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('xz is unavailable.')); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_ARCHIVE) { child.kill(); reject(new Error('Package expands beyond size limit.')); }
      else chunks.push(chunk);
    });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Package decompression failed.')); });
    child.stdin.end(data);
  });
}
async function download(url, fetcher) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Package download failed (${response.status}).`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_ARCHIVE) throw new Error('Package download exceeds size limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export function createPackageManager({ prefix, stateDir, baselineFile, fetcher = fetch }) {
  const registryFile = path.join(stateDir, 'packages.json');
  async function installed() {
    const map = new Map();
    for (const [file, bundled] of [[baselineFile, true], [registryFile, false]]) {
      try { for (const pkg of JSON.parse(await readFile(file, 'utf8'))) map.set(pkg.package, { ...pkg, bundled }); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Package registry is unreadable.'); }
    }
    return map;
  }
  async function plan(name) {
    const bytes = await download(BASE + 'dists/stable/main/binary-aarch64/Packages.gz', fetcher);
    const index = parsePackageIndex(gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString());
    const current = await installed();
    const packages = resolvePackages(index, current, name);
    return { name, packages, current };
  }
  async function install(name, output = () => {}) {
    await mkdir(stateDir, { recursive: true });
    const lockFile = path.join(stateDir, 'package-install.lock');
    let lock;
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch { throw new Error('Another installation is active, or an interrupted install left a lock. Inspect package-install.lock before retrying.'); }
    const created = []; const directories = [];
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      const result = await plan(name);
      const prepared = [];
      for (const pkg of result.packages) {
        if (!/^pool\/[a-zA-Z0-9/+_.-]+\.deb$/.test(pkg.Filename) || pkg.Filename.includes('..')) throw new Error('Invalid package source.');
        output(`Downloading ${pkg.Package} ${pkg.Version}`);
        const archive = await download(BASE + pkg.Filename, fetcher);
        if (archive.length !== Number(pkg.Size) || crypto.createHash('sha256').update(archive).digest('hex') !== pkg.SHA256) throw new Error(`Checksum mismatch: ${pkg.Package}`);
        const members = debMembers(archive);
        const data = [...members].find(([key]) => key.startsWith('data.tar'));
        const control = [...members].find(([key]) => key.startsWith('control.tar'));
        if (!data || !control) throw new Error('Package payload missing.');
        const scripts = tarEntries(await decompress(...control, prefix)).filter((entry) => /(?:^|\/)(preinst|postinst|prerm|postrm|config)$/.test(entry.name)).map((entry) => entry.name);
        if (scripts.length) output(`Note: maintainer scripts are NOT executed (${pkg.Package}: ${scripts.join(', ')}). Some package features may need manual setup.`);
        prepared.push({ pkg, entries: tarEntries(await decompress(...data, prefix)).map(prefixEntry).filter(Boolean) });
      }
      const seen = new Set();
      // Validate every destination before changing anything. Never replace app runtime files.
      for (const { entries } of prepared) for (const entry of entries) {
        const destination = path.join(prefix, entry.relative);
        let parent = prefix;
        for (const part of entry.relative.split('/').slice(0, -1)) {
          parent = path.join(parent, part);
          const stats = await lstat(parent).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          if (stats && !stats.isDirectory()) throw new Error('Package path traverses a non-directory.');
        }
        const existing = await lstat(destination).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        if (entry.type === '5' && (existing?.isDirectory() || seen.has(entry.relative))) continue;
        if (existing || seen.has(entry.relative)) throw new Error(`Refusing to overwrite ${entry.relative}.`);
        seen.add(entry.relative);
      }
      async function ensureDirectory(directory) {
        if (directory === prefix) return;
        const exists = await lstat(directory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        if (exists) { if (!exists.isDirectory()) throw new Error('Unsafe directory.'); return; }
        await ensureDirectory(path.dirname(directory));
        await mkdir(directory); directories.push(directory);
      }
      const ordered = prepared.flatMap(({ entries }) => entries).sort((a, b) => (a.type === '2') - (b.type === '2'));
      for (const entry of ordered) {
        const destination = path.join(prefix, entry.relative);
        await ensureDirectory(path.dirname(destination));
        if (entry.type === '5') { await ensureDirectory(destination); continue; }
        if (entry.type === '2') await symlink(entry.link, destination);
        else {
          let data = entry.data;
          // Relocate script interpreters, not arbitrary ELF contents.
          if (data.subarray(0, 2).toString() === '#!') {
            const newline = data.indexOf(10);
            if (newline >= 0 && newline < 1024) {
              const firstLine = data.subarray(0, newline).toString().replace('/' + TERMUX_PREFIX, prefix);
              data = Buffer.concat([Buffer.from(firstLine), data.subarray(newline)]);
            }
          }
          const file = await open(destination, 'wx', entry.mode & 0o755);
          created.push(destination);
          try { await file.writeFile(data); } finally { await file.close(); }
        }
        if (entry.type === '2') created.push(destination);
      }
      const records = [...result.current.values()].filter((pkg) => !pkg.bundled).map(({ bundled, ...pkg }) => pkg);
      for (const { pkg, entries } of prepared) records.push({ package: pkg.Package, version: pkg.Version, sha256: pkg.SHA256,
        source: BASE + pkg.Filename, installedAt: new Date().toISOString(), files: entries.filter((entry) => entry.type !== '5').map((entry) => entry.relative) });
      const temporary = registryFile + '.tmp';
      await writeFile(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
      await rename(temporary, registryFile);
      output(result.packages.length ? `Installed: ${result.packages.map((pkg) => pkg.Package).join(', ')}` : `${name} is already installed.`);
      return records;
    } catch (error) {
      for (const file of created.reverse()) await unlink(file).catch(() => {});
      for (const directory of directories.reverse()) await rmdir(directory).catch(() => {});
      await unlink(registryFile + '.tmp').catch(() => {});
      throw error;
    } finally { await lock.close(); await unlink(lockFile).catch(() => {}); }
  }
  return { installed, plan, install };
}
