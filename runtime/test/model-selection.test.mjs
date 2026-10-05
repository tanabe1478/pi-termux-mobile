import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// No real credentials: the model request fails locally, but must retain the user's selection.
test('model survives submit, fresh SSE attachment, and process restart', { timeout: 20_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'pi-model-test-'));
  let child;
  let base;
  let headers;
  async function start() {
    const env = { PATH: process.env.PATH, HOME: home, PI_WORKDIR: home };
    child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        const port = await readFile(path.join(home, '.pi-mobile/port'), 'utf8');
        const token = await readFile(path.join(home, '.pi-mobile/token'), 'utf8');
        base = `http://127.0.0.1:${port}`;
        headers = { 'x-token': token.trim(), 'content-type': 'application/json' };
        if ((await fetch(base + '/api/state', { headers })).ok) return;
      } catch {}
      await delay(50);
    }
    throw new Error('Bridge did not start');
  }
  async function stop() {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  async function request(endpoint, body) {
    const r = await fetch(base + endpoint, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, 200);
    return r.json();
  }
  const model = { provider: 'openai', modelId: 'gpt-6.1-sol' };
  try {
    await start();
    assert.deepEqual((await request('/api/model', model)).applied, model);
    assert.deepEqual((await request('/api/state')).model, model);
    assert.equal((await request('/api/prompt', { message: 'test' })).ok, true);
    assert.deepEqual((await request('/api/state')).model, model);
    const controller = new AbortController();
    const response = await fetch(base + '/api/events', { headers, signal: controller.signal });
    const reader = response.body.getReader();
    let text = '';
    let snapshot;
    while (!snapshot) {
      const part = await reader.read();
      text += new TextDecoder().decode(part.value);
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'bridge_snapshot') snapshot = ev.snapshot; } catch {}
      }
    }
    assert.deepEqual(snapshot.agent.model, model);
    controller.abort();
    await stop();
    await start();
    assert.deepEqual((await request('/api/state')).model, model);
    await stop();
    child = null;
  } finally {
    if (child && child.exitCode === null) await stop();
    await rm(home, { recursive: true, force: true });
  }
});
