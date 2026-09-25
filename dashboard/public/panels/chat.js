/**
 * Chat — the agent itself, in the browser. Same brain, tools, and
 * workspace as the terminal; streams NDJSON from POST /api/chat and
 * renders tool calls the way the CLI does (⏺ call, ⎿ result).
 */
export default {
  id: 'chat',
  title: 'Chat with Social Agents',
  subtitle: 'Same agent as the terminal — ask it to check, fix, or change anything above',
  icon: '❯',
  route: '/chat',

  // No fetch gate — the chat is interactive from the first paint.
  render(root, _data, ctx) {
    const { h } = ctx;
    let sessionId = null;
    let busy = false;

    const scroll = h('div', { class: 'chat-scroll' },
      h('div', { class: 'chat-msg agent' },
        'Social Agents here. I can read everything this dashboard shows — try "why did my last reply fail?" or "turn on the engagement sweep".'));
    const push = (cls, text) => {
      const el = h('div', { class: cls }, text);
      scroll.append(el);
      scroll.scrollTop = scroll.scrollHeight;
      return el;
    };

    const input = h('input', { class: 'input', placeholder: 'talk to your social agents…', autocomplete: 'off' });
    const sendBtn = h('button', { class: 'btn btn-primary', onclick: () => send() }, 'Send');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    // The CreatorOS mark is the thinking icon — rotating steadily while
    // the agent works. No pulsing.
    const logo = (size) => h('img', { class: 'spinner-logo', src: '/assets/creatoros-logo.png', alt: '', style: `width:${size}px;height:${size}px` });
    let think = null;
    let thinkTimer = null;
    const startThinking = () => {
      const secs = h('span', {}, '0s');
      think = h('div', { class: 'chat-thinking' }, logo(20), h('span', {}, 'social agents are thinking…'), secs);
      scroll.append(think);
      scroll.scrollTop = scroll.scrollHeight;
      const startedAt = Date.now();
      thinkTimer = setInterval(() => {
        if (!think || !think.isConnected) { clearInterval(thinkTimer); return; }
        secs.textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`;
      }, 500);
    };
    const stopThinking = () => {
      if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
      if (think) { think.remove(); think = null; }
    };

    async function send() {
      const message = input.value.trim();
      if (!message || busy) return;
      input.value = '';
      busy = true;
      sendBtn.replaceChildren(logo(18));
      push('chat-msg user', message);
      startThinking();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId }),
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type !== 'init') stopThinking(); // first sign of life
            if (ev.type === 'init') sessionId = ev.sessionId;
            else if (ev.type === 'text') push('chat-msg agent', ev.text.trim());
            else if (ev.type === 'tool') push('chat-tool', `⏺ ${ev.name}(${(ev.args || '{}').slice(1, -1)})`);
            else if (ev.type === 'tool_result') push(`chat-tool result${ev.isError ? '' : ''}`, `⎿ ${ev.text}`);
            else if (ev.type === 'error') push('chat-tool result', `⎿ ${ev.text}`);
          }
        }
      } catch (error) {
        push('chat-tool result', `⎿ connection lost: ${error.message}`);
      }
      stopThinking();
      busy = false;
      sendBtn.replaceChildren('Send');
      input.focus();
    }

    root.append(
      h('div', { class: 'card-solid chat-wrap' },
        scroll,
        h('div', { class: 'chat-input-row' }, input, sendBtn),
      ),
    );
    input.focus();
  },
};
