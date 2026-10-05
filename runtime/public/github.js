import { renderMenu } from './menu.js';
const token = renderMenu();
const form = document.getElementById('github-form');
const input = document.getElementById('github-token');
const save = document.getElementById('github-save');
const disconnect = document.getElementById('github-disconnect');
const status = document.getElementById('github-status');
const message = document.getElementById('github-message');
let working = false;

async function request(body) {
  const response = await fetch('/api/github', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-token': token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'GitHub認証を確認できませんでした。');
  return result;
}
function render(result) {
  status.textContent = result.connected ? `接続済み: ${result.user}` : '未接続';
  disconnect.hidden = !result.connected;
  save.textContent = result.connected ? '別のトークンで更新' : '認証して保存';
}
function setWorking(value) {
  working = value;
  save.disabled = value;
  disconnect.disabled = value;
  input.disabled = value;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (working) return;
  const credential = input.value.trim();
  if (!credential) return;
  input.value = ''; // Do not retain credentials in UI or localStorage.
  setWorking(true);
  message.textContent = 'GitHubアカウントを確認しています…';
  try { render(await request({ token: credential })); message.textContent = '保存しました。GitHub HTTPSのclone・pushで使用できます。'; }
  catch (error) { message.textContent = error.message; }
  finally { setWorking(false); }
});
disconnect.addEventListener('click', async () => {
  if (working) return;
  setWorking(true);
  try { render(await request({ delete: true })); message.textContent = '端末内の認証を削除しました。'; }
  catch (error) { message.textContent = error.message; }
  finally { setWorking(false); }
});
request().then(render).catch((error) => { status.textContent = error.message; });
