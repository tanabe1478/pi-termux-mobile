import { API } from './constants.js';
import { renderMenu } from './menu.js';
import { assistantText, assistantError } from './conversation-state.js';
import { updateActivity, elapsedLabel } from './activity.js';

const token = renderMenu();

const chat = document.getElementById('chat');
const input = document.getElementById('input');
const statusEl = document.getElementById('status');
const sessionNameEl = document.getElementById('session-name');

let currentAssistant = null;
let liveMessage = { content: [] };
let activityState = { busy: false, label: '', startedAt: null, tools: {} };
let activityTimer = null;
let abortPending = false;
const activityEl = document.getElementById('activity');
const activityLabel = document.getElementById('activity-label');
const activityElapsed = document.getElementById('activity-elapsed');
const stopButton = document.getElementById('activity-stop');

function showActivity(event) {
  activityState = updateActivity(activityState, event);
  activityEl.hidden = !activityState.busy;
  activityLabel.textContent = activityState.label;
  activityElapsed.textContent = activityState.busy ? elapsedLabel(activityState.startedAt) : '';
  stopButton.disabled = abortPending;
  if (activityState.busy && activityTimer === null) {
    activityTimer = setInterval(() => {
      activityElapsed.textContent = elapsedLabel(activityState.startedAt);
    }, 1000);
  } else if (!activityState.busy) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

stopButton.addEventListener('click', async () => {
  if (abortPending || !activityState.busy) return;
  abortPending = true;
  const previous = activityState;
  showActivity({ type: 'abort_start' });
  try {
    const result = await post(API.abort);
    if (result.error) throw new Error(result.error);
    showActivity({ type: 'run_end' });
    status('idle');
  } catch (error) {
    activityState = previous;
    addSys(`停止できませんでした: ${error.message}`);
  } finally {
    abortPending = false;
    showActivity({ type: 'refresh' });
  }
});

function el(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}

function addUser(text) { currentAssistant = null; el('msg user', text); }
function addAssistant() {
  if (!currentAssistant) currentAssistant = el('msg assistant', '');
  return currentAssistant;
}
function addTool(name, args) {
  currentAssistant = null;
  const brief = args ? (args.command || args.path || args.pattern || JSON.stringify(args).slice(0, 80)) : '';
  el('msg tool', `⚙ ${name}${brief ? '  ' + brief : ''}`);
}
function addSys(text) { currentAssistant = null; el('msg sys', text); }

function renderHistory(entries) {
  chat.innerHTML = '';
  for (const e of entries) {
    for (const m of e.model ?? []) {
      if (m.role === 'user' && typeof m.content === 'string') el('msg user', m.content);
      else if (m.role === 'assistant' && Array.isArray(m.content)) {
        const text = assistantText(m);
        if (text) el('msg assistant', text);
        const error = assistantError(m);
        if (error) el('msg sys', `エラー: ${error}`);
      } else if (m.role === 'toolResult') {
        el('msg tool', `⚙ ${m.toolName || 'tool'}`);
      }
    }
  }
  chat.scrollTop = chat.scrollHeight;
}

function handleEvent(ev) {
  showActivity(ev);
  switch (ev.type) {
    case 'message_start': {
      if (ev.message?.role === 'assistant') {
        currentAssistant = null;
        liveMessage = structuredClone(ev.message);
        const text = assistantText(liveMessage);
        if (text) addAssistant().textContent = text;
      }
      break;
    }
    case 'message_end': {
      for (const m of ev.entry?.model ?? []) {
        if (m.role !== 'assistant') continue;
        const text = assistantText(m);
        if (text) addAssistant().textContent = text;
        const error = assistantError(m);
        if (error) addSys(`エラー: ${error}`);
        currentAssistant = null;
        liveMessage = { content: [] };
      }
      break;
    }
    case 'message_update': {
      for (const change of ev.changes ?? []) {
        if (change.type === 'message') liveMessage = structuredClone(change.message);
        else if (change.block) liveMessage.content[change.contentIndex] = structuredClone(change.block);
        else if (change.type === 'text_delta') {
          const block = liveMessage.content[change.contentIndex] ??= { type: 'text', text: '' };
          block.text += change.delta;
        }
      }
      const text = assistantText(liveMessage);
      if (text) addAssistant().textContent = text;
      chat.scrollTop = chat.scrollHeight;
      break;
    }
    case 'run_end': currentAssistant = null; status('idle'); break;
    case 'turn_start': status('running…'); break;
    case 'tool_execution_start': addTool(ev.toolName || ev.tool || ev.name || 'tool', ev.args); break;
    case 'tool_execution_end': {
      if (ev.isError || ev.error) addSys(`tool error: ${ev.error || 'failed'}`);
      break;
    }
    case 'turn_end': currentAssistant = null; break;
    case 'agent_end': currentAssistant = null; status('idle'); break;
    case 'agent_settled': status('idle'); break;
    case 'compaction_start': addSys('compacting…'); break;
    case 'auto_retry_start': addSys(`retry ${ev.attempt}/${ev.maxAttempts}: ${ev.errorMessage || ''}`); break;
    case 'bash_execution_update': {
      if (ev.delta) {
        const b = addAssistant();
        b.textContent += ev.delta;
        chat.scrollTop = chat.scrollHeight;
      }
      break;
    }
    
    case 'snapshot':
    case 'bridge_snapshot': {
      const snapshot = ev.snapshot ?? ev;
      currentModel = snapshot.agent?.model || null;
      syncModelSelect();
      currentAssistant = null;
      liveMessage = structuredClone(snapshot.generation?.message ?? { content: [] });
      renderHistory(snapshot.entries ?? []);
      const text = assistantText(liveMessage);
      if (text) addAssistant().textContent = text;
      status(snapshot.run ? 'running…' : 'idle');
      break;
    }
    case 'agent_changed':
    case 'agent': {
      const m = ev.agent?.model;
      if (m) { currentModel = m; syncModelSelect(); }
      break;
    }
    case 'run_start': status('running…'); break;
    case 'task_failed': addSys(`エラー: ${ev.message}`); break;
    case 'submission':
      if (ev.record?.status === 'unanswered') {
        addSys(`応答に失敗しました: ${ev.record.reason || 'unknown'}`);
        // An unanswered queued submission need not mean the active run ended.
        if (!activityState.busy) status('idle');
      }
      break;
    case 'bridge_error': addSys(`error: ${ev.error}`); break;
    case 'error': addSys(`error: ${ev.error?.message || ev.error || 'unknown'}`); break;
    default: break;
  }
}

function status(t) { statusEl.textContent = t; }

function connect() {
  const es = new EventSource(`${API.events}?token=${encodeURIComponent(token)}`);
  es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
  es.onerror = () => {
    status('reconnecting…');
    showActivity({ type: 'connection_lost' });
  };
}

async function post(endpoint, body = {}) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: JSON.stringify(body),
  });
  return r.json();
}

document.getElementById('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addUser(text);
  status('running…');
  const wasBusy = activityState.busy;
  showActivity({ type: 'submit_start' });
  try {
    const r = await post(API.prompt, { message: text });
    if (r.error) throw new Error(r.error);
  } catch (error) {
    addSys(`送信できませんでした: ${error.message}`);
    if (!wasBusy) {
      showActivity({ type: 'submit_failed' });
      status('idle');
    }
  }
});

// header menu is rendered by menu.js (brand -> home, ≡ dropdown)

// --- model picker ------------------------------------------------------------

const modelSelect = document.getElementById('model-select');
let currentModel = null;

function syncModelSelect() {
  if (!currentModel) return;
  const v = `${currentModel.provider}|${currentModel.modelId}`;
  if (![...modelSelect.options].some((o) => o.value === v)) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = `${currentModel.provider}/${currentModel.modelId}`;
    modelSelect.appendChild(o);
  }
  modelSelect.value = v;
}

async function refreshModels() {
  try {
    const r = await fetch(`${API.models}?token=${encodeURIComponent(token)}`);
    const j = await r.json();
    modelSelect.innerHTML = '<option value="">no model</option>';
    for (const m of j.models ?? []) {
      const o = document.createElement('option');
      o.value = `${m.provider}|${m.modelId}`;
      o.textContent = `${m.provider}/${m.modelId}`;
      modelSelect.appendChild(o);
    }
    syncModelSelect();
  } catch {}
}

modelSelect.addEventListener('change', async () => {
  const [provider, modelId] = modelSelect.value.split('|');
  if (!modelId) return;
  const r = await post(API.model, { provider, modelId });
  addSys(r.ok ? `model → ${provider}/${modelId}` : `error: ${r.error}`);
});

window.addEventListener('chatgpt-authenticated', async () => {
  const state = await fetch(API.state, { headers: { 'x-token': token } }).then((r) => r.json());
  currentModel = state.model;
  await refreshModels();
});

connect();
refreshModels();
fetch(`${API.state}?token=${encodeURIComponent(token)}`)
  .then((r) => r.json())
  .then((state) => {
    sessionNameEl.textContent = state.sessionName || 'Main';
    currentModel = state.model;
    syncModelSelect();
    status(state.busy ? 'running…' : 'idle');
    // SSE snapshots are authoritative and carry generation/tool state.
    // If SSE has not connected yet, at least show the running indicator.
    if (state.busy && !activityState.busy) showActivity({ type: 'run_start' });
  })
  .catch(() => status('offline'));
