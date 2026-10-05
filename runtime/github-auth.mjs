import { readFile, writeFile, mkdir, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function githubStatus(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return { connected: Boolean(data.token && data.user), user: data.user || null };
  } catch { return { connected: false, user: null }; }
}

export async function saveGitHubToken(file, token, fetcher = fetch) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /\s/.test(token.trim())) {
    throw new Error('GitHubトークンを確認してください。');
  }
  const value = token.trim();
  let response;
  try {
    response = await fetcher('https://api.github.com/user', {
      headers: { authorization: `Bearer ${value}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'pi-mobile' },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
  } catch { throw new Error('GitHubに接続できませんでした。通信状態を確認してください。'); }
  if (!response.ok) throw new Error('GitHub認証に失敗しました。トークンの有効期限・権限を確認してください。');
  const user = await response.json();
  if (typeof user.login !== 'string' || !/^[a-zA-Z0-9-]+$/.test(user.login)) {
    throw new Error('GitHubアカウントを確認できませんでした。');
  }
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ token: value, user: user.login }), { mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
  return { connected: true, user: user.login };
}

export async function deleteGitHubToken(file) {
  await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  return { connected: false, user: null };
}

// A directly executable Node script avoids git's hard-coded Termux shell path.
// The token is not placed in git URLs, config, argv or child environment variables.
export function gitAskpassSource(node, credentialFile) {
  return `#!${node}
import { readFileSync } from 'node:fs';
const prompt = process.argv[2] || '';
const match = prompt.match(/'(https:\\/\\/[^']+)'/);
if (!match) process.exit(1);
let url;
try { url = new URL(match[1]); } catch { process.exit(1); }
if (url.protocol !== 'https:' || url.hostname !== 'github.com' || (url.port && url.port !== '443')) process.exit(1);
if (/^Username/i.test(prompt)) { process.stdout.write('x-access-token\\n'); }
else if (/^Password/i.test(prompt)) {
  try {
    const credential = JSON.parse(readFileSync(${JSON.stringify(credentialFile)}, 'utf8'));
    if (!credential.token) process.exit(1);
    process.stdout.write(credential.token + '\\n');
  } catch { process.exit(1); }
} else process.exit(1);
`;
}

export async function installGitAskpass(node, credentialFile, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, gitAskpassSource(node, credentialFile), { mode: 0o700 });
  await chmod(target, 0o700);
}

export function githubGitEnv(askpass) {
  return {
    GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0',
    // Do not let credential helpers cache a copy outside the app credential file.
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.useHttpPath', GIT_CONFIG_VALUE_1: 'true',
  };
}
