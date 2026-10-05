// Pi Durable stores agent/live/inbox in docs; watchEvents.snapshot is attachment-time only.
export function snapshotFromView(view) {
  const live = view.docs?.['pi.live'] ?? {};
  return {
    type: 'snapshot', entries: view.entries ?? [],
    ...(live.run ? { run: { inputs: live.run.inputs } } : {}),
    ...(live.generation ? { generation: live.generation } : {}),
    tools: live.tools ?? [], compactions: live.compactions ?? [],
    inbox: (view.docs?.['pi.inbox']?.items ?? []).map(({ id, mode }) => ({ id, mode })),
    agent: view.docs?.['pi.agent'] ?? {}, usage: view.docs?.['pi.usage'] ?? {},
  };
}

export function assistantText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((block) => block.type === 'text').map((block) => block.text).join('');
}

export function assistantError(message) {
  return message?.errorMessage || (message?.stopReason === 'error' ? 'モデルからの応答に失敗しました。' : '');
}
