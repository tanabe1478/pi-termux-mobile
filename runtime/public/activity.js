// Activity is driven by durable run events, not by the arrival of visible text.
export function updateActivity(state, event, now = Date.now()) {
  const idle = () => ({ busy: false, label: '', startedAt: null, tools: {} });
  const running = (label) => ({ ...state, busy: true, label, startedAt: state.startedAt ?? now, tools: state.tools ?? {} });
  switch (event.type) {
    case 'submit_start': return state.busy ? state : running('送信しています…');
    case 'submit_failed':
    case 'run_end':
    case 'agent_end':
    case 'agent_settled': return idle();
    case 'run_start':
    case 'turn_start': return running('考えています…');
    case 'message_start':
      if (event.message?.role !== 'assistant') return state;
      return running(event.message.content?.some((block) => block.type === 'text' && block.text)
        ? '回答を生成しています…' : '考えています…');
    case 'message_update': {
      const changes = event.changes ?? [];
      if (changes.some((change) => change.type === 'text_delta'
        || change.block?.type === 'text'
        || change.message?.content?.some((block) => block.type === 'text' && block.text))) {
        return running('回答を生成しています…');
      }
      if (changes.some((change) => change.type.startsWith('thinking') || change.block?.type === 'thinking')) {
        return running('考えています…');
      }
      return state;
    }
    case 'tool_execution_start': {
      const tools = { ...state.tools, [event.toolCallId]: event.toolName || 'tool' };
      return { ...running(''), tools, label: `ツール実行中: ${Object.values(tools).join(', ')}` };
    }
    case 'tool_execution_end': {
      const tools = { ...state.tools };
      delete tools[event.toolCallId];
      return { ...running('考えています…'), tools,
        label: Object.keys(tools).length ? `ツール実行中: ${Object.values(tools).join(', ')}` : '考えています…' };
    }
    case 'auto_retry_start': return running(`再試行しています… (${event.attempt})`);
    case 'auto_retry_end': return running('考えています…');
    case 'deferred_poll': return running('モデルの応答を待っています…');
    case 'abort_start': return running('停止しています…');
    case 'connection_lost': return { ...state, label: state.busy ? '再接続しています…' : '' };
    case 'snapshot':
    case 'bridge_snapshot': {
      const snapshot = event.snapshot ?? event;
      if (!snapshot.run) return idle();
      const tools = Object.fromEntries((snapshot.tools ?? []).filter((tool) => tool.status === 'running')
        .map((tool) => [tool.callId, tool.name]));
      const label = Object.keys(tools).length ? `ツール実行中: ${Object.values(tools).join(', ')}`
        : snapshot.generation?.retry ? '再試行しています…'
        : snapshot.generation?.message?.content?.some((block) => block.type === 'text' && block.text)
          ? '回答を生成しています…' : '考えています…';
      return { ...running(label), tools };
    }
    default: return state;
  }
}

export function elapsedLabel(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
