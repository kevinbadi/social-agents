/**
 * Brand — the agent's personality file (social-agents/BRAND.md), rendered as
 * markdown with edit-in-place. The path + last-modified are shown so
 * users trust this is exactly what the agent reads.
 */

/** Shared by Brand and Training: a rendered file card with an edit mode. */
export function fileEditor({ h, md, api, timeAgo }, file, saveBody, onSaved) {
  const body = h('div', {});
  const meta = h('div', { class: 'file-meta' },
    h('span', {}, 'path: ', h('code', {}, file.path ?? file.id)),
    h('span', {}, `last modified ${timeAgo(file.mtime)}`),
  );

  const showView = () => {
    body.replaceChildren(
      meta,
      md(file.content),
      h('div', { style: 'margin-top:16px' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: showEdit }, '✎ Edit')),
    );
  };
  const showEdit = () => {
    const area = h('textarea', { class: 'input' });
    area.value = file.content;
    const status = h('span', { style: 'color:var(--text-3);font-size:13px;align-self:center' });
    body.replaceChildren(
      meta, area,
      h('div', { style: 'margin-top:12px;display:flex;gap:10px' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
          status.textContent = 'saving…';
          try {
            await api(saveBody.url, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...saveBody.extra, content: area.value }),
            });
            file.content = area.value;
            file.mtime = new Date().toISOString();
            showView();
            if (onSaved) onSaved();
          } catch (error) {
            status.textContent = `save failed: ${error.message}`;
          }
        } }, 'Save'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: showView }, 'Cancel'),
        status,
      ),
    );
  };
  showView();
  return body;
}

export default {
  id: 'brand',
  title: 'Brand',
  subtitle: 'The agent’s personality — voice, offers, links, do/don’ts',
  icon: '✦',
  route: '/brand',

  fetchData: ({ api }) => api('/api/brand'),

  render(root, file, ctx) {
    const { h, card, note } = ctx;
    if (!file.exists) {
      root.append(
        card('No brand file yet',
          h('p', { style: 'margin-bottom:12px' },
            `The agent reads its personality from ${file.path}, and that file doesn't exist yet. The onboarding interview writes it:`),
          h('div', { class: 'code-row' }, h('code', {}, 'npm start creatoros social-agents')),
        ),
      );
      return;
    }
    const hint = note('brand-edit',
      'Edits save straight back to disk — the agent reads the latest version on its next action. No restart needed.');
    if (hint) root.append(hint);
    root.append(card('social-agents/BRAND.md', fileEditor(ctx, file, { url: '/api/brand', extra: {} })));
  },
};
