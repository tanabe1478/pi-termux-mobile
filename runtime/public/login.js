const token = new URLSearchParams(location.search).get('token') || localStorage.getItem('pi-token') || '';
const endpoint = '/api/login/chatgpt';
const button = document.getElementById('chatgpt-login');
const dialog = document.getElementById('login-dialog');
const message = document.getElementById('login-message');
const status = document.getElementById('login-status');
const browser = document.getElementById('login-browser');
const form = document.getElementById('login-response');
const input = document.getElementById('login-callback');
const close = document.getElementById('login-close');
let current = null;
let timer = null;

async function request(path = endpoint, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-token': token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error('ログイン状態を取得できませんでした。');
  return res.json();
}
function render(state) {
  current = state;
  const pending = state.status === 'pending';
  button.disabled = pending;
  message.textContent = state.message || '';
  status.textContent = state.message || '';
  close.textContent = pending ? 'キャンセル' : '閉じる';
  browser.hidden = !state.url;
  if (state.url) {
    const url = new URL(state.url);
    // OAuth links only: never send the app's bridge token to an external site.
    if (url.protocol === 'https:' && url.hostname === 'auth.openai.com') browser.href = url.href;
    else browser.hidden = true;
  } else browser.removeAttribute('href');
  form.hidden = !state.prompt;
  if (state.status === 'done') {
    input.value = '';
    window.dispatchEvent(new Event('chatgpt-authenticated'));
  }
}
async function poll() {
  clearTimeout(timer);
  try {
    const state = await request();
    render(state);
    if (state.status === 'pending') timer = setTimeout(poll, 1000);
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
    if (current?.status === 'pending') timer = setTimeout(poll, 3000);
  }
}
button.addEventListener('click', async () => {
  button.disabled = true;
  input.value = '';
  if (!dialog.open) dialog.showModal();
  message.textContent = 'ログインを準備しています…';
  try { render(await request(endpoint, {})); await poll(); }
  catch (error) { message.textContent = error.message; button.disabled = false; }
});
async function dismiss() {
  try {
    if (current?.status === 'pending') await request(`${endpoint}/cancel`, {});
    clearTimeout(timer);
    button.disabled = false;
    dialog.close();
  } catch (error) { message.textContent = error.message; }
}
close.addEventListener('click', dismiss);
dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = input.value.trim();
  if (!answer || !current?.prompt) return;
  try {
    await request(`${endpoint}/respond`, { id: current.id, promptId: current.prompt.id, answer });
    input.value = '';
    await poll();
  } catch (error) { message.textContent = error.message; }
});
// Resume polling when returning from the system browser or after reloading the UI.
window.addEventListener('focus', poll);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
request().then((state) => {
  if (state.status === 'pending') { dialog.showModal(); render(state); poll(); }
}).catch(() => {});
