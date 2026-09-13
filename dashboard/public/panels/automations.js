/**
 * Automations — every agentic workflow drawn n8n/Make-style: trigger →
 * filter → action → outcome node chains, one card per flow, with origin
 * (cloud = CreatorOS servers, local/railway = the agent's pathway),
 * health, and live stats. Below the flows: a real-time executions feed
 * merging cloud funnel logs with the agent's local activity log.
 */
export default {
  id: 'automations',
  title: 'Automations',
  subtitle: 'Every agentic workflow, cloud and local — and whether it’s operating well',
  icon: '⟳',
  route: '/automations',

  fetchData: ({ api }) => api('/api/automations'),

  render(root, data, ctx) {
    const { h, card, badge, dot, timeAgo, note, api } = ctx;

    if (!data.connected) {
      const hint = note('automations-connect',
        'Cloud flows come from your CreatorOS account; connect one (npm start creatoros midas) to see live funnel state and execution logs. Local flows render from this repo either way.');
      if (hint) root.append(hint);
    } else if (!data.cloudScoped) {
      // Connected key, but no onboarded profile — cloud automations are
      // deliberately NOT shown: the key sees the whole account, and this
      // workspace only owns one profile.
      root.append(h('div', { class: 'note' },
        'Cloud automations are hidden until onboarding links this workspace to a profile. Your API key can see every profile on the account — the dashboard only ever shows the one this workspace manages. Run npm start creatoros midas to finish setup.'));
    }

    const healthBadge = (flow) => {
      if (flow.health === 'failing') return badge(`failing · ${flow.stats.failed} failed`, 'failed');
      if (flow.health === 'healthy') return badge('operating', 'sent');
      if (flow.health === 'idle') return badge('armed · no runs yet', 'pending');
      return badge('off', 'skipped');
    };
    const originBadge = (origin) =>
      h('span', { class: `origin-badge${origin === 'cloud' ? ' cloud' : ''}` },
        origin === 'cloud' ? '☁ cloud · CreatorOS' : origin === 'railway' ? '▲ railway' : '⌂ local');

    /* ---- flow cards ---- */
    const flowCard = (flow) => {
      const stateClass = flow.health === 'off' ? 'flow-off' : flow.health === 'failing' ? 'flow-failing' : flow.enabled ? 'flow-on' : '';
      const graph = h('div', { class: 'flow-graph' });
      flow.nodes.forEach((node, i) => {
        if (i > 0) graph.append(h('div', { class: 'flow-link' }));
        graph.append(
          h('div', { class: `flow-node ${node.kind}` },
            h('div', { class: 'fn-top' }, h('span', { class: 'fn-icon' }, node.icon), node.label),
            node.sub ? h('div', { class: 'fn-sub', title: node.sub }, node.sub) : null,
          ),
        );
      });
      const s = flow.stats;
      return h('div', { class: `card-solid flow-card ${stateClass}` },
        h('div', { class: 'flow-head' },
          dot(flow.health === 'failing' ? 'failed' : flow.health === 'healthy' ? 'sent' : 'skipped'),
          h('span', { class: 'flow-name' }, flow.name),
          h('div', { class: 'flow-meta' }, originBadge(flow.origin), healthBadge(flow)),
        ),
        graph,
        h('div', { class: 'flow-stats num' },
          s.lastTs
            ? `last run ${timeAgo(s.lastTs)} (${s.lastOutcome}) · ${s.sent} sent · ${s.skipped} skipped · ${s.failed} failed`
            : flow.enabled ? 'no executions recorded yet' : 'turned off — ask Midas in chat to arm it'),
        flow.detail
          ? h('details', { style: 'margin-top:8px' },
              h('summary', { style: 'cursor:pointer;color:var(--text-4);font-size:12.5px' }, 'configuration'),
              h('pre', { style: 'margin-top:6px;padding:10px;border-radius:10px;background:var(--inset);border:1px solid var(--border);font-size:12px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:var(--text-2)' }, flow.detail))
          : null,
      );
    };

    /* ---- Railway worker status strip ---- */
    const untilShort = (iso) => {
      const ms = new Date(iso).getTime() - Date.now();
      if (!Number.isFinite(ms)) return '';
      if (ms <= 0) return 'now';
      const m = Math.round(ms / 60000);
      return m < 60 ? `in ${m}m` : m < 1440 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`;
    };
    if (data.worker && data.worker.configured) {
      const w = data.worker;
      const broken = w.deploy && w.deploy.broken;
      const state = broken || !w.reachable ? 'failed' : 'sent';
      const label = broken
        ? `deploy ${w.deploy.status.toLowerCase()}`
        : w.reachable
          ? (w.running ? `up · running ${w.running}` : 'up · on schedule')
          : 'unreachable — check the Railway service';
      const nexts = (w.automations || [])
        .filter((a) => a.enabled && a.nextRun)
        .sort((a, b) => (a.nextRun < b.nextRun ? -1 : 1))
        .slice(0, 3)
        .map((a) => `${a.name} ${untilShort(a.nextRun)}`);
      root.append(
        h('div', { class: 'card-solid', style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px' },
          dot(state),
          h('span', { class: 'flow-name' }, '▲ Railway worker'),
          badge(label, state),
          w.deploy && !broken ? badge(`deploy ${w.deploy.status.toLowerCase()}`, 'sent') : null,
          nexts.length ? h('span', { class: 'num', style: 'color:var(--text-3);font-size:12.5px' }, `next: ${nexts.join(' · ')}`) : null,
        ),
      );
    }

    const flowsWrap = h('div', {});
    const renderFlows = (flows) => {
      flowsWrap.replaceChildren(
        flows.length
          ? h('div', {}, flows.map(flowCard))
          : h('div', { class: 'card-solid' },
              h('p', { style: 'color:var(--text-3)' },
                'No automations exist yet. Ask Midas in the chat — "set up auto-replies" or "run a funnel on my latest post" — and the flows appear here as they go live.')),
      );
    };
    renderFlows(data.flows);
    root.append(flowsWrap);

    /* ---- real-time executions feed ---- */
    const runsBody = h('div', {});
    const renderRuns = (runs) => {
      runsBody.replaceChildren(
        runs.length
          ? h('div', {}, runs.map((r) => h('div', { class: 'feed-row', style: 'flex-wrap:wrap' },
              dot(r.outcome),
              h('span', { class: 'when' }, timeAgo(r.ts)),
              h('span', { class: 'what' }, r.action),
              h('span', { class: 'meta' }, [r.flow, r.platform, r.target].filter(Boolean).join(' · ')),
              h('span', { class: `origin-badge${r.origin === 'cloud' ? ' cloud' : ''}`, style: 'font-size:9.5px' },
                r.origin === 'cloud' ? '☁' : r.origin === 'railway' ? '▲' : '⌂'),
              badge(r.outcome, r.outcome),
              r.error ? h('span', { class: 'meta', style: 'flex-basis:100%;padding-left:86px;color:var(--text-2)' }, r.error) : null,
            )))
          : h('p', { style: 'color:var(--text-3)' }, 'No executions yet — this feed fills in live as flows run (cloud funnel sends and local agent actions).'),
      );
    };
    renderRuns(data.runs);
    const runsCard = card('Executions — live, cloud + local', runsBody);
    root.append(h('div', { style: 'margin-top:4px' }, runsCard));

    // Poll while on screen: refresh flows (health can flip) and the feed.
    const timer = setInterval(async () => {
      if (!runsCard.isConnected) { clearInterval(timer); return; }
      try {
        const fresh = await api('/api/automations');
        renderFlows(fresh.flows);
        renderRuns(fresh.runs);
      } catch { /* keep the last good view */ }
    }, 8000);

    /* ---- reference: raw cron list + catalog ---- */
    root.append(
      h('details', { class: 'card-solid', style: 'margin-top:16px' },
        h('summary', {}, 'Raw cron registry (creatoros automations:list)'),
        h('div', { class: 'details-body' },
          data.crons.output
            ? h('pre', { style: 'padding:12px;border-radius:12px;background:var(--inset);border:1px solid var(--border);font-size:12.5px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:var(--text-2)' }, data.crons.output)
            : h('p', { style: 'color:var(--text-3)' }, 'No cron automations registered yet.'))),
      h('details', { class: 'card-solid', style: 'margin-top:12px' },
        h('summary', {}, 'Workflow catalog & roadmap'),
        h('div', { class: 'details-body' },
          data.catalog.map((w) => h('div', { class: 'feed-row' },
            badge(w.status === 'live' ? 'live' : w.status === 'available' ? 'ready' : 'soon',
              w.status === 'live' ? 'sent' : w.status === 'available' ? 'skipped' : 'pending'),
            h('span', { class: 'what' }, w.name),
            h('span', { class: 'meta' }, w.description),
          )))),
    );
  },
};
