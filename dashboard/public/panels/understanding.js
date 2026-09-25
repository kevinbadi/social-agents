/**
 * Agent — full transparency into what Social Agents understands: its persona,
 * its objective and the KPIs it's judged on, how it handles comments
 * and messages, what the account is actually selling, and the literal
 * system prompt it runs on. Every card names the file it comes from, so
 * customizing the agent is always one edit away.
 */
export default {
  id: 'agent',
  title: 'Agent',
  subtitle: 'What Social Agents understands — persona, goals, KPIs, and the rules it plays by',
  icon: '◉',
  route: '/agent',

  fetchData: ({ api }) => api('/api/understanding'),

  render(root, data, ctx) {
    const { h, card, badge, timeAgo, note } = ctx;

    /* Small helpers local to this panel */
    const empty = (text, cta) => h('div', { style: 'color:var(--text-3);font-size:13.5px' },
      text, ' ', cta ? h('a', { href: cta.href }, cta.label) : null);
    const quote = (text) => h('div', {
      style: 'border-left:3px solid var(--accent-border);padding:2px 0 2px 14px;font-size:15px;color:var(--text-2);white-space:pre-wrap',
    }, text);
    const chips = (items, on) => h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
      items.map((c) => h('span', { class: `chip chip-static${on ? ' chip-on' : ''}` }, c)));
    const srcLine = (label, href) => h('div', { style: 'margin-top:12px;font-size:12px;color:var(--text-4)' },
      'source: ', h('a', { href }, label));

    if (!data.configured && !data.brand) {
      root.append(
        card('The agent has no understanding yet',
          h('p', { style: 'margin-bottom:12px' },
            'Persona, goals, and brand knowledge are written during onboarding — nothing exists to show yet:'),
          h('div', { class: 'code-row' }, h('code', {}, 'npm start creatoros social-agents')),
        ),
      );
      return;
    }

    const hint = note('agent-transparency',
      'Everything on this page is read live from the files the agent reads — social-agents/BRAND.md and social-agents/social-agents.json. Change a file (Brand and Training pages edit in place) and the agent behaves differently on its very next action.');
    if (hint) root.append(hint);

    /* ---- Row 1: who the agent is · what it's driving toward ---- */
    const identity = data.identity;
    const voice = data.brand?.voice;
    root.append(
      h('div', { class: 'grid grid-2', style: 'margin-bottom:16px' },
        card('Who your agents are — persona',
          identity
            ? h('div', {},
                quote(identity.persona),
                voice?.soundsLike?.length ? chips(voice.soundsLike.map((v) => `sounds ${v}`)) : null,
                voice?.never ? chips([`never ${voice.never}`]) : null,
                voice?.emojiPolicy ? h('p', { class: 'stat-sub', style: 'margin-top:10px' },
                  `emoji: ${voice.emojiPolicy} · hashtags: ${voice.hashtagPolicy ?? 'unset'}`) : null,
                srcLine('social-agents/social-agents.json → engagementAgent', '#/automations'))
            : empty('No persona programmed yet — the engagement agent replies in a generic brand voice until you give it one.',
                { href: '#/chat', label: 'ask Social Agents to set one →' }),
        ),
        card('What it’s driving toward — objective',
          identity
            ? h('div', {},
                h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
                  badge(identity.objectiveLabel ?? identity.objective, 'sent'),
                  identity.objectiveDetail ? h('a', { href: identity.objectiveDetail.startsWith('http') ? identity.objectiveDetail : null, target: '_blank', rel: 'noopener', style: 'font-size:13.5px;word-break:break-all' }, identity.objectiveDetail) : null,
                ),
                identity.drives ? h('p', { style: 'margin-top:10px;color:var(--text-3);font-size:13.5px' }, identity.drives) : null,
                h('p', { class: 'stat-sub', style: 'margin-top:12px' }, 'Standing mission — the four pillars:'),
                h('ul', { style: 'margin:6px 0 0 18px;font-size:13px;color:var(--text-3)' },
                  data.mission.map((m) => h('li', {}, m))),
                srcLine('social-agents/social-agents.json → engagementAgent.objective', '#/automations'))
            : empty('No objective set — conversations have nowhere to steer.', { href: '#/chat', label: 'set one in chat →' }),
        ),
      ),
    );

    /* ---- Row 2: what the account is selling · who it talks to ---- */
    const brand = data.brand;
    root.append(
      h('div', { class: 'grid grid-2', style: 'margin-bottom:16px' },
        card('What we’re actually selling',
          brand?.about ? h('p', { style: 'margin-bottom:10px;color:var(--text-2)' }, brand.about) : null,
          brand?.offers?.length
            ? h('div', {}, brand.offers.map((o) => h('div', { class: 'feed-row' },
                h('span', { class: 'what' }, o.description),
                o.link ? h('a', { class: 'meta', href: o.link, target: '_blank', rel: 'noopener' }, o.link) : h('span', { class: 'meta' }, 'no link yet'),
              )))
            : empty('No offers on record — every CTA needs a destination.', { href: '#/brand', label: 'add offers in the brand pack →' }),
          brand ? srcLine(`${data.brandMeta?.path ?? 'social-agents/BRAND.md'} · modified ${timeAgo(data.brandMeta?.mtime)}`, '#/brand') : null,
        ),
        card('Who we’re talking to',
          brand?.audience
            ? h('div', {},
                quote(brand.audience),
                brand.competitors?.length
                  ? h('div', {}, h('p', { class: 'stat-sub', style: 'margin-top:12px' }, 'watching competitors:'), chips(brand.competitors))
                  : null,
                srcLine(data.brandMeta?.path ?? 'social-agents/BRAND.md', '#/brand'))
            : empty('No target audience defined yet.', { href: '#/brand', label: 'define it in the brand pack →' }),
        ),
      ),
    );

    /* ---- KPIs the agent is judged on ---- */
    root.append(
      h('div', { class: 'card-solid', style: 'margin-bottom:16px' },
        h('div', { class: 'card-title' }, 'KPIs your agents are watching'),
        h('div', { class: 'grid grid-stats' },
          data.kpis.map((k) => h('div', {},
            h('div', { style: 'display:flex;align-items:center;gap:8px' },
              h('span', { class: `status-dot ${k.state === 'good' ? 'st-good' : k.state === 'bad' ? 'st-fail' : 'st-idle'}` }),
              h('span', { class: 'stat-value num' }, k.value)),
            h('div', { class: 'stat-label' }, k.label),
            h('div', { class: 'stat-sub num' }, k.sub),
          ))),
        h('p', { class: 'stat-sub', style: 'margin-top:12px' },
          'Live numbers from the activity log (logs/activity.jsonl) — the same feed as the Overview and Logs pages.'),
      ),
    );

    /* ---- How it handles comments & messages ---- */
    const eng = data.engagement;
    const channel = (title, cfg, extra) => card(title,
      cfg
        ? h('div', {},
            h('div', { style: 'display:flex;gap:10px;align-items:center' },
              badge(cfg.enabled ? 'on' : 'off', cfg.enabled ? 'sent' : 'skipped'),
              cfg.enabled ? chips(cfg.platforms) : h('span', { class: 'stat-sub' }, 'not answering on any platform')),
            extra ?? null,
            eng.escalate?.length
              ? h('p', { class: 'stat-sub', style: 'margin-top:12px' }, `always escalated to the human: ${eng.escalate.join(', ')}`)
              : null,
            srcLine('social-agents/social-agents.json → autoReplies', '#/automations'))
        : empty('Not configured yet.', { href: '#/chat', label: 'turn it on in chat →' }));

    root.append(
      h('div', { class: 'grid grid-2', style: 'margin-bottom:16px' },
        channel('How it handles comments', eng.comments,
          eng.funnel
            ? h('div', { style: 'margin-top:12px' },
                h('p', { class: 'stat-sub' }, 'comment → DM funnel:'),
                h('p', { style: 'font-size:13.5px;color:var(--text-2);margin-top:4px' },
                  `keyword ${eng.funnel.keywords.map((k) => `"${k}"`).join(', ')} triggers a DM`,
                  eng.funnel.link ? ` carrying ${eng.funnel.link}` : ''),
                quote(eng.funnel.dmMessage))
            : null),
        channel('How it handles messages (DMs)', eng.messages, null),
      ),
    );

    /* ---- The literal instructions ---- */
    root.append(
      h('details', { class: 'card-solid' },
        h('summary', {}, 'The exact instructions the agent runs on (system prompt)'),
        h('div', { class: 'details-body' },
          h('p', { class: 'stat-sub', style: 'margin-bottom:10px' },
            'Rendered live from your config — this is verbatim what every chat turn and automation run starts with.'),
          h('pre', { style: 'padding:14px;border-radius:12px;background:var(--inset);border:1px solid var(--border);font-size:12px;line-height:1.55;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:var(--text-2)' },
            data.systemPrompt))),
    );

    /* ---- Where it all comes from ---- */
    root.append(
      h('div', { class: 'card-solid', style: 'margin-top:16px' },
        h('div', { class: 'card-title' }, 'Where this understanding lives'),
        data.sources.map((s) => h('div', { class: 'feed-row' },
          h('span', { class: `status-dot ${s.mtime ? 'st-good' : 'st-idle'}` }),
          h('span', { class: 'what' }, s.label),
          h('span', { class: 'meta' }, s.mtime ? `${s.path} · modified ${timeAgo(s.mtime)}` : `${s.path} · not created yet`),
          h('a', { class: 'meta', href: `#${s.editRoute}` }, 'edit →'),
        ))),
    );
  },
};
