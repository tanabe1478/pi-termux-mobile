import { mkdir, open, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';

export function githubCLISource(node, native, credentialFile) {
  return `#!${node}
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if ((args[0] === 'auth' && args[1] === 'token') || args.includes('--show-token') || (args[0] === 'auth' && args.includes('-t'))) {
  console.error('Credential display is disabled. Manage authentication in pi mobile → GitHub.'); process.exit(1);
}
for (let i = 0; i < args.length; i++) {
  const host = args[i] === '--hostname' ? args[i + 1] : args[i].startsWith('--hostname=') ? args[i].slice(11) : null;
  if (host && host !== 'github.com') { console.error('This credential is restricted to github.com.'); process.exit(1); }
  if (/^https?:\\/\\//i.test(args[i])) {
    let url; try { url = new URL(args[i]); } catch { process.exit(1); }
    if (url.protocol !== 'https:' || !['github.com', 'api.github.com'].includes(url.hostname) || url.username || url.password || url.port) {
      console.error('GitHub credential use is restricted to official HTTPS endpoints.'); process.exit(1);
    }
  }
}
const env = { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' };
delete env.GH_TOKEN; delete env.GITHUB_TOKEN; delete env.GH_ENTERPRISE_TOKEN; delete env.GITHUB_ENTERPRISE_TOKEN;
try {
  const auth = JSON.parse(readFileSync(${JSON.stringify(credentialFile)}, 'utf8'));
  if (auth.token) env.GH_TOKEN = auth.token;
} catch {}
const child = spawn(${JSON.stringify(native)}, args, { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('GitHub CLI could not start.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
`;
}

export async function ensureGitHubCLI(prefix, home, node = process.execPath) {
  const launcher = path.join(prefix, 'bin/gh');
  const native = path.join(prefix, 'libexec/pi-mobile/gh');
  let file;
  let isNative = false;
  try {
    file = await open(launcher, 'r');
    const magic = Buffer.alloc(4);
    await file.read(magic, 0, 4, 0);
    isNative = magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { await file?.close(); }
  if (isNative) {
    await mkdir(path.dirname(native), { recursive: true });
    await rename(launcher, native);
  } else {
    try { const check = await open(native, 'r'); await check.close(); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
  try {
    await writeFile(launcher, githubCLISource(node, native, path.join(home, '.pi/agent/github.json')), { mode: 0o700 });
    await chmod(launcher, 0o700);
  } catch (error) {
    if (isNative) await rename(native, launcher);
    throw error;
  }
}

export async function installPackageCLI(prefix, home, runtime, node = process.execPath) {
  const target = path.join(prefix, 'bin/pi-pkg');
  await mkdir(path.dirname(target), { recursive: true });
  const source = `#!${node}
const { spawn } = require('node:child_process');
const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(path.join(runtime, 'package-cli.mjs'))}, ...process.argv.slice(2)], {
  env: { ...process.env, PREFIX: ${JSON.stringify(prefix)}, HOME: ${JSON.stringify(home)} }, stdio: 'inherit'
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Package installer could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
`;
  await writeFile(target, source, { mode: 0o700 });
  await chmod(target, 0o700);
  await ensureGitHubCLI(prefix, home, node);
}
