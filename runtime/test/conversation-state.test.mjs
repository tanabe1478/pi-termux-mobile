import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromView, assistantText, assistantError } from '../public/conversation-state.js';

test('snapshot reads durable documents, including current model and busy state', () => {
  const model = { provider: 'openai', modelId: 'gpt-6.1-sol' };
  const snapshot = snapshotFromView({
    entries: [{ id: 1 }],
    docs: {
      'pi.agent': { model },
      'pi.live': { run: { inputs: [3] }, generation: { message: { content: [] } } },
      'pi.inbox': { items: [{ id: 4, mode: 'followUp', content: 'not needed' }] },
    },
  });
  assert.deepEqual(snapshot.agent.model, model);
  assert.deepEqual(snapshot.run, { inputs: [3] });
  assert.deepEqual(snapshot.inbox, [{ id: 4, mode: 'followUp' }]);
  assert.equal(snapshot.entries.length, 1);
  assert.ok(snapshot.generation);
  assert.equal(snapshotFromView({ docs: { 'pi.live': { tools: [] } } }).run, undefined);
});

test('text and errors are independently rendered, thinking is not answer text', () => {
  assert.equal(assistantText({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] }), 'Hello world');
  assert.equal(assistantText({ content: [] }), '');
  assert.equal(assistantError({ stopReason: 'error', errorMessage: 'unsupported model' }), 'unsupported model');
  assert.ok(assistantError({ stopReason: 'error' }));
});
