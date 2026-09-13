/**
 * Training — the workflow/playbook files that teach the agent specific
 * behaviors (comment→DM workflow, messaging playbooks, posting skills).
 * Each card: name, purpose, last modified, and — from the activity log —
 * when the agent last ran it and how that went. Same edit-in-place as Brand.
 */
import { fileEditor } from './brand.js';

export default {
  id: 'training',
  title: 'Training',
  subtitle: 'Workflow playbooks the agent executes',
  icon: '⧉',
  route: '/training',

  fetchData: ({ api }) => api('/api/workflows'),

  render(root, data, ctx) {
    const { h, card, badge, timeAgo, note } = ctx;

    if (data.source === 'template') {
      const hint = note('training-template',
        'Showing the repo’s template playbooks — onboarding installs a copy into midas/skills/ that the agent actually runs. Edits here change the templates for future installs.');
      if (hint) root.append(hint);
    }
    if (!data.files.length) {
      root.append(card('No training files found', h('p', {}, 'No workflow playbooks exist yet — run onboarding to install the starter skills.')));
      return;
    }

    for (const file of data.files) {
      const stats = file.stats;
      root.append(
        h('details', { class: 'card-solid', style: 'margin-bottom:14px' },
          h('summary', {},
            h('span', { style: 'display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap' },
              file.name,
              stats?.failed ? badge(`${stats.failed} failed`, 'failed') : null,
              h('span', { style: 'color:var(--text-4);font-weight:400;font-size:12.5px' },
                `${file.purpose} · modified ${timeAgo(file.mtime)} · ` +
                (file.lastUsed
                  ? `last used ${timeAgo(file.lastUsed)} (${stats.sent} sent / ${stats.skipped} skipped / ${stats.failed} failed)`
                  : 'not yet observed in the activity log')),
            )),
          h('div', { class: 'details-body' },
            fileEditor(ctx, file, { url: '/api/workflows', extra: { id: file.id } })),
        ),
      );
    }
  },
};
