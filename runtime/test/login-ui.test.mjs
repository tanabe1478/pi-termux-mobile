import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

async function page(state) {
  const elements = new Map();
  const events = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, value: '', textContent: '', disabled: false, open: false,
      addEventListener() {}, removeAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return elements.get(id);
  }
  const source = await readFile(new URL('../public/login.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    document: { getElementById: element, addEventListener() {}, hidden: false },
    window: { addEventListener(name, fn) { events.set(name, fn); }, dispatchEvent() {} },
    location: { search: '', hash: '', pathname: '/' }, localStorage: { getItem() { return ''; } },
    URL, URLSearchParams, Event, history: { replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => state }),
    setTimeout() { return 1; }, clearTimeout() {},
  });
  await setImmediate();
  return { elements, events };
}

test('authenticated ChatGPT hides login bar; menu still has a login action', async () => {
  const { elements, events } = await page({ status: 'idle', authenticated: true });
  assert.equal(elements.get('login-bar').hidden, true);
  assert.ok(events.has('open-chatgpt-login'));
});

test('unauthenticated ChatGPT shows login bar; successful login hides it', async () => {
  const loggedOut = await page({ status: 'idle', authenticated: false });
  assert.equal(loggedOut.elements.get('login-bar').hidden, false);
  const loggedIn = await page({ id: 'test', status: 'done', authenticated: true });
  assert.equal(loggedIn.elements.get('login-bar').hidden, true);
  const deleted = await page({ id: 'test', status: 'done', authenticated: false });
  assert.equal(deleted.elements.get('login-bar').hidden, false);
});
