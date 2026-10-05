import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { githubStatus, saveGitHubToken, deleteGitHubToken, installGitAskpass, githubGitEnv } from '../github-auth.mjs';

async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-github-test-'));
  try { await run(path.join(dir, 'github.json'), path.join(dir, 'askpass.mjs')); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const fakeCredential = 'TEST_ONLY_CREDENTIAL';

test('validate account before saving; return metadata only; private file and logout', async () => fixture(async (file) => {
  assert.equal((await githubStatus(file)).connected, false);
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${fakeCredential}`);
    return { ok: true, json: async () => ({ login: 'test-user' }) };
  };
  const result = await saveGitHubToken(file, fakeCredential, fetcher);
  assert.deepEqual(result, { connected: true, user: 'test-user' });
  assert.ok(!JSON.stringify(await githubStatus(file)).includes(fakeCredential));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file)).token, fakeCredential);
  await deleteGitHubToken(file);
  assert.equal((await githubStatus(file)).connected, false);
}));

test('invalid tokens do not replace existing credentials or leak provider errors', async () => fixture(async (file) => {
  await writeFile(file, JSON.stringify({ token: fakeCredential, user: 'test-user' }));
  await assert.rejects(saveGitHubToken(file, 'bad token'), /確認/);
  await assert.rejects(saveGitHubToken(file, 'bad', async () => ({ ok: false })), /認証に失敗/);
  await assert.rejects(saveGitHubToken(file, 'bad', async () => { throw new Error('PRIVATE_PROVIDER_RESPONSE'); }),
    (error) => !error.message.includes('PRIVATE_PROVIDER_RESPONSE'));
  assert.equal(JSON.parse(await readFile(file)).token, fakeCredential);
}));

test('git askpass supplies GitHub credentials only, without secrets in environment or argv', async () => fixture(async (file, helper) => {
  await writeFile(file, JSON.stringify({ token: fakeCredential, user: 'test-user' }));
  await installGitAskpass(process.execPath, file, helper);
  const env = githubGitEnv(helper);
  assert.ok(!JSON.stringify(env).includes(fakeCredential));
  assert.equal(env.GIT_CONFIG_VALUE_0, '');
  const ask = (prompt) => spawnSync(helper, [prompt], { encoding: 'utf8' });
  assert.equal(ask("Username for 'https://github.com': ").stdout.trim(), 'x-access-token');
  assert.equal(ask("Password for 'https://x-access-token@github.com/owner/repo.git': ").stdout.trim(), fakeCredential);
  for (const prompt of ["Password for 'https://github.com.evil.test': ", "Password for 'http://github.com': ",
    "Password for 'https://github.com:444': ", "Password for 'https://gitlab.com': ", 'Password: ']) {
    const result = ask(prompt);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
  await deleteGitHubToken(file);
  assert.notEqual(ask("Password for 'https://github.com': ").status, 0);
}));
