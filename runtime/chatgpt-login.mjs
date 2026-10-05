import crypto from 'node:crypto';

// One bounded, cancellable login per bridge. Never expose the returned credential.
export function createChatGPTLogin({ login, onSuccess, timeoutMs = 300_000 }) {
  let session = null;
  function state() {
    if (!session) return { status: 'idle' };
    const { id, status, url, message, prompt } = session;
    return { id, status, url, message, prompt };
  }
  function cancel() {
    if (session?.status === 'pending') session.controller.abort();
  }
  function start() {
    if (session?.status === 'pending') return state();
    const current = session = {
      id: crypto.randomUUID(), status: 'pending', controller: new AbortController(),
      message: 'ログインを準備しています…',
    };
    const timer = setTimeout(() => current.controller.abort(), timeoutMs);
    timer.unref?.();
    const interaction = {
      signal: current.controller.signal,
      notify(event) {
        if (event.type === 'auth_url') {
          current.url = event.url;
          current.message = 'ブラウザでログインした後、この画面に戻ってください。';
        } else if (event.type === 'progress') {
          current.message = '認証を確認しています…';
        }
      },
      prompt(value) {
        return new Promise((resolve, reject) => {
          const signal = value.signal
            ? AbortSignal.any([value.signal, current.controller.signal])
            : current.controller.signal;
          const cleanup = () => {
            signal.removeEventListener('abort', abort);
            delete current.prompt;
            delete current.respond;
          };
          const abort = () => { cleanup(); reject(new Error('Login cancelled')); };
          if (signal.aborted) return abort();
          // OpenAI's flow only needs the full callback URL as a manual fallback.
          if (value.type !== 'manual_code') return reject(new Error('Unexpected login prompt'));
          current.prompt = { id: crypto.randomUUID(), type: value.type };
          current.respond = (answer) => { cleanup(); resolve(answer); };
          signal.addEventListener('abort', abort, { once: true });
        });
      },
    };
    current.done = (async () => {
      try {
        await login(interaction);
        await onSuccess();
        current.status = 'done';
        current.message = 'ChatGPTにログインしました。';
      } catch {
        current.status = current.controller.signal.aborted ? 'cancelled' : 'error';
        current.message = current.status === 'cancelled'
          ? 'ログインをキャンセルしました（または時間切れ）。'
          : 'ログインできませんでした。ブラウザの案内を確認して再試行してください。';
      } finally {
        clearTimeout(timer);
        delete current.url;
        delete current.prompt;
        delete current.respond;
      }
    })();
    return state();
  }
  function respond(id, promptId, answer) {
    if (session?.id !== id || session.status !== 'pending'
      || session.prompt?.id !== promptId || !session.respond) return false;
    session.respond(answer);
    return true;
  }
  return { start, state, cancel, respond };
}
