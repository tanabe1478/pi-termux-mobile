import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { githubCLISource } from '../cli-bootstrap.mjs';

test('gh reads the saved credential internally and refuses accidental token display/external hosts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-gh-test-'));
  try {
    const credential = path.join(dir, 'github.json');
    const native = path.join(dir, 'native');
    const wrapper = path.join(dir, 'gh');
    await writeFile(credential, JSON.stringify({ token: 'TEST_ONLY_CREDENTIAL' }), { mode: 0o600 });
    await writeFile(native, `#!${process.execPath}\nconsole.log(process.env.GH_TOKEN === 'TEST_ONLY_CREDENTIAL' && process.env.GH_HOST === 'github.com' ? 'AUTH_OK' : 'AUTH_FAILED');\n`, { mode: 0o700 });
    await writeFile(wrapper, githubCLISource(process.execPath, native, credential), { mode: 0o700 });
    const run = (args) => spawnSync(wrapper, args, { encoding: 'utf8' });
    assert.equal(run(['api', 'user', '--jq', '.login']).stdout.trim(), 'AUTH_OK');
    for (const args of [['auth','token'],['auth','status','--show-token'],['api','user','--hostname','evil.test'],['api','https://evil.test/user']]) {
      const result = run(args);
      assert.notEqual(result.status, 0);
      assert.ok(!result.stdout.includes('TEST_ONLY_CREDENTIAL'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
