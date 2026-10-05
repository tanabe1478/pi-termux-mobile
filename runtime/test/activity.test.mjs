import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateActivity, elapsedLabel } from '../public/activity.js';

const idle = () => ({ busy: false, label: '', startedAt: null, tools: {} });

test('spinner appears immediately and stays until run settles, including tool turns', () => {
  let state = updateActivity(idle(), { type: 'submit_start' }, 1000);
  assert.equal(state.busy, true);
  assert.match(state.label, /送信/);
  state = updateActivity(state, { type: 'run_start' }, 2000);
  assert.equal(state.startedAt, 1000);
  assert.match(state.label, /考え/);
  state = updateActivity(state, { type: 'message_update', changes: [{ type: 'thinking_delta', delta: 'hidden' }] });
  assert.match(state.label, /考え/);
  assert.ok(!state.label.includes('hidden'));
  state = updateActivity(state, { type: 'message_update', changes: [{ type: 'text_delta', delta: 'hello' }] });
  assert.match(state.label, /回答/);
  state = updateActivity(state, { type: 'message_end' });
  assert.equal(state.busy, true);
  state = updateActivity(state, { type: 'tool_execution_start', toolCallId: '1', toolName: 'bash' });
  state = updateActivity(state, { type: 'tool_execution_start', toolCallId: '2', toolName: 'read' });
  assert.match(state.label, /bash, read/);
  state = updateActivity(state, { type: 'tool_execution_end', toolCallId: '1' });
  assert.match(state.label, /read/);
  state = updateActivity(state, { type: 'tool_execution_end', toolCallId: '2' });
  assert.match(state.label, /考え/);
  state = updateActivity(state, { type: 'run_end' });
  assert.deepEqual(state, idle());
});

test('snapshot restores activity on reconnect, retry and abort are visible', () => {
  let state = updateActivity(idle(), { type: 'bridge_snapshot', snapshot: {
    run: { inputs: [1] }, tools: [{ callId: '1', status: 'running', name: 'subagent' }],
  } }, 1000);
  assert.match(state.label, /subagent/);
  state = updateActivity(state, { type: 'connection_lost' });
  assert.equal(state.busy, true);
  assert.match(state.label, /再接続/);
  state = updateActivity(state, { type: 'auto_retry_start', attempt: 2 });
  assert.match(state.label, /再試行.*2/);
  state = updateActivity(state, { type: 'abort_start' });
  assert.match(state.label, /停止/);
  state = updateActivity(state, { type: 'snapshot', agent: {}, tools: [] });
  assert.deepEqual(state, idle());
});

test('idle history messages do not start spinner, failed submit clears it', () => {
  assert.deepEqual(updateActivity(idle(), { type: 'message_start', message: { role: 'user' } }), idle());
  const pending = updateActivity(idle(), { type: 'submit_start' }, 1000);
  assert.deepEqual(updateActivity(pending, { type: 'submit_failed' }), idle());
  assert.equal(elapsedLabel(1000, 1000), '0秒');
  assert.equal(elapsedLabel(1000, 62000), '1分1秒');
  assert.equal(elapsedLabel(1000, 0), '0秒');
});
