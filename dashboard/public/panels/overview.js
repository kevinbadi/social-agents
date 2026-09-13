/**
 * Overview — "is my agent working?" at a glance: health strip, headline
 * counters, the year heatmap, and a live auto-refreshing activity feed.
 */
export default {
  id: 'overview',
  title: 'Overview',
  subtitle: 'Is my agent working?',
  icon: '◈',
  route: '/',

  async fetchData({ api }) {
    // Both fetches settle before the page reveals (no pop-in). Each side
    // degrades on its own: a failure becomes {error} for an inline card.
    const [health, activity] = await Promise.all([
      api('/api/health').catch((e) => ({ error: e.message })),
      api('/api/activity?limit=25&kind=engagement').catch((e) => ({ error: e.message })),
    ]);
    return { health, activity };
  },

  render(root, { health, activity }, ctx) {
    const { h, card, errorCard, badge, dot, timeAgo, heatmap, note, api } = ctx;

    /* ---- connect state: missing credentials never crash, they instruct ---- */
    if (health && !health.error && !health.credentials.present) {
      root.append(
        card('Connect your CreatorOS account',
          h('p', { style: 'margin-bottom:12px' },
            'Midas has no CreatorOS API key yet, so there is nothing to monitor. Two minutes fixes that:'),
          h('div', { class: 'code-row', style: 'margin-bottom:10px' }, h('code', {}, 'npm start creatoros midas')),
          h('p', { style: 'color:var(--text-3);font-size:13.5px' },
            'The onboarding interview collects your API key (CreatorOS app → Settings → API Key), your brand pack, and your automations — then this dashboard lights up.'),
        ),
      );
      return;
    }

    /* ---- health strip ---- */
    if (health?.error) {
      root.append(errorCard('Health', health.error));
    } else if (health) {
      const cred = health.credentials;
      const item = (state, label, title) => h('div', { class: 'health-item', title: title || '' }, dot(state), label);
      root.append(
        h('div', { class: 'health-strip', style: 'margin-bottom:18px' },
          item(health.configLoaded ? 'sent' : 'failed', health.configLoaded ? 'config loaded' : 'config missing',
            health.files.map((f) => `${f.label}: ${f.exists ? f.path : 'missing'}`).join('\n')),
          item(cred.valid ? 'sent' : 'failed', cred.valid ? `API key valid (${cred.maskedKey})` : `API key ✗ ${cred.error || ''}`),
          item(health.brain.ready ? 'sent' : 'skipped', `brain: ${health.brain.label}`),
          item(health.stale ? 'failed' : health.lastAction ? 'sent' : 'skipped',
            health.lastAction ? `last action ${timeAgo(health.lastAction.ts)}` : 'no actions logged yet',
            health.stale ? 'Automations are on but the agent has been silent for over 24h — check the Logs page.' : ''),
        ),
      );
      if (health.stale) {
        root.append(h('div', { class: 'note' },
          '⚠ Automations are on, but no action has been logged for over 24 hours. Check the Logs page, or ask Midas "are my automations running?" in the chat.'));
      }
    }

    /* ---- counters + heatmap + feed ---- */
    if (activity?.error) {
      root.append(errorCard('Activity', activity.error));
      return;
    }
    const s = activity.summary;
    const stat = (value, label, sub) => h('div', { class: 'card-solid' },
      h('div', { class: 'stat-value num' }, String(value)),
      h('div', { class: 'stat-label' }, label),
      sub ? h('div', { class: 'stat-sub num' }, sub) : null);

    root.append(
      h('div', { class: 'grid grid-stats', style: 'margin-bottom:16px' },
        stat(s.today.replies, 'replies today', `${s.week.replies} this week`),
        stat(s.today.dms, 'DMs today', `${s.week.dms} this week`),
        stat(s.today.posts, 'posts today', `${s.week.posts} this week`),
        stat(s.today.skipped, 'skipped today', `${s.week.skipped} this week`),
        stat(s.today.failed, 'failed today', `${s.week.failed} this week`),
      ),
      card(
        activity.source === 'railway'
          ? 'Agent activity — last 12 months · ▲ Railway worker'
          : 'Agent activity — last 12 months',
        heatmap(s.heatmap)),
    );

    const hint = note('feed-hint',
      'This feed is the agent’s audience-facing work — every reply, DM, and post, newest first, merged from this machine AND the Railway worker. Setup actions (creating automations, webhooks) live on the Logs page with filters and raw payloads.');
    if (hint) root.append(h('div', { style: 'margin-top:16px' }, hint));

    /* ---- live feed, auto-refreshing ---- */
    const feedBody = h('div', {});
    const renderFeed = (entries) => {
      feedBody.replaceChildren(
        entries.length
          ? h('div', {}, entries.map((e) => h('div', { class: 'feed-row' },
              dot(e.outcome),
              h('span', { class: 'when' }, timeAgo(e.ts)),
              h('span', { class: 'what' }, e.action),
              h('span', { class: 'meta' }, [e.workflow, e.platform].filter(Boolean).join(' · ')),
              badge(e.outcome, e.outcome),
            )))
          : h('p', { style: 'color:var(--text-3)' }, 'No actions yet. Once the agent replies, DMs, or posts, it shows up here within seconds.'),
      );
    };
    renderFeed(activity.entries);
    const feedCard = card('Live activity', feedBody);
    root.append(h('div', { style: 'margin-top:16px' }, feedCard));

    // Poll while this page is on screen; the interval kills itself on nav.
    const timer = setInterval(async () => {
      if (!feedCard.isConnected) { clearInterval(timer); return; }
      try { renderFeed((await api('/api/activity?limit=25&kind=engagement')).entries); } catch { /* keep the last view */ }
    }, 5000);
  },
};
