import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createChatGPTLogin } from '../chatgpt-login.mjs';

async function settled(manager) {
  for (let i = 0; i < 100; i++) {
    if (manager.state().status !== 'pending') return manager.state();
    await delay(5);
  }
  throw new Error('Login did not settle');
}

test('manual fallback, duplicate start, stale answers, credential never exposed', async () => {
  let calls = 0;
  let success = 0;
  const manager = createChatGPTLogin({
    login: async (interaction) => {
      calls++;
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/test' });
      assert.equal(await interaction.prompt({ type: 'manual_code' }), 'callback');
      return { access: 'SECRET', refresh: 'SECRET' };
    },
    onSuccess: async () => { success++; },
  });
  const state = manager.start();
  assert.equal(manager.start().id, state.id);
  assert.equal(calls, 1);
  assert.equal(manager.respond('stale', state.prompt.id, 'wrong'), false);
  assert.equal(manager.respond(state.id, 'stale', 'wrong'), false);
  assert.equal(manager.respond(state.id, state.prompt.id, 'callback'), true);
  const done = await settled(manager);
  assert.equal(done.status, 'done');
  assert.equal(success, 1);
  assert.equal(done.url, undefined);
  assert.equal(done.prompt, undefined);
  assert.ok(!JSON.stringify(done).includes('SECRET'));
});

test('browser callback cancels pending manual prompt and completes', async () => {
  const manager = createChatGPTLogin({
    login: async (interaction) => {
      const controller = new AbortController();
      const manual = interaction.prompt({ type: 'manual_code', signal: controller.signal });
      const winner = await Promise.race([manual, Promise.resolve('browser')]);
      controller.abort();
      assert.equal(winner, 'browser');
    },
    onSuccess: async () => {},
  });
  manager.start();
  assert.equal((await settled(manager)).status, 'done');
});

test('cancel and retry', async () => {
  const manager = createChatGPTLogin({
    login: async (interaction) => interaction.prompt({ type: 'manual_code' }),
    onSuccess: async () => {},
  });
  const first = manager.start();
  manager.cancel();
  assert.equal((await settled(manager)).status, 'cancelled');
  assert.notEqual(manager.start().id, first.id);
  manager.cancel();
  await settled(manager);
});

test('timeout closes login', async () => {
  const manager = createChatGPTLogin({
    timeoutMs: 10,
    login: async (interaction) => interaction.prompt({ type: 'manual_code' }),
    onSuccess: async () => {},
  });
  manager.start();
  assert.equal((await settled(manager)).status, 'cancelled');
});

test('errors do not expose provider response secrets', async () => {
  const manager = createChatGPTLogin({
    login: async () => { throw new Error('access_token=SECRET'); },
    onSuccess: async () => {},
  });
  manager.start();
  const state = await settled(manager);
  assert.equal(state.status, 'error');
  assert.ok(!JSON.stringify(state).includes('SECRET'));
});
