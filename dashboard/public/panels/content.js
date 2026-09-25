/**
 * Content — the v1.1 tease. Posting at scale gets its own surface:
 * content library, calendar, and the content-marketing workflows from
 * the roadmap. Nothing functional yet, deliberately — this page sets
 * the expectation and points at chat for what works today.
 */
export default {
  id: 'content',
  title: 'Content',
  subtitle: 'Posting at scale gets its own home',
  icon: '▤',
  route: '/content',

  render(root, _data, ctx) {
    const { h, card, badge } = ctx;

    const COMING = [
      ['Content Library', 'Drop clips in, see them as a grid — what posted, what’s queued, what’s untouched.'],
      ['Visual Calendar', 'The week as a board: every scheduled post, drag to re-time, gaps highlighted.'],
      ['Trend Scanner', 'What’s moving in your niche each morning, turned into ready-to-shoot angles.'],
      ['Clip Repurposer', 'One long-form video in, a week of shortform out — cuts, captions, per-platform framing.'],
      ['Carousel Factory', 'Winning captions and ideas become Instagram carousel scripts on a schedule.'],
      ['Hook Lab', 'A/B tested hooks with a scoreboard — winners fold back into the brand pack.'],
    ];

    root.append(
      h('div', { class: 'card-solid', style: 'text-align:center;padding:48px 24px;margin-bottom:16px' },
        h('img', { src: '/assets/creatoros-logo.png', alt: '', style: 'width:64px;height:64px;object-fit:contain;margin-bottom:16px' }),
        h('h2', { style: 'font-size:26px;letter-spacing:-0.02em;margin-bottom:8px;text-transform:none' }, 'Content is coming in Social Agents v1.1'),
        h('p', { style: 'color:var(--text-3);max-width:52ch;margin:0 auto' },
          'The engagement engine shipped first. Next release, creating and shipping content at scale gets this page — library, calendar, and the workflows below.'),
        h('div', { style: 'margin-top:16px' }, badge('v1.1', 'pending')),
      ),
      h('div', { class: 'grid grid-2' },
        COMING.map(([name, desc]) => h('div', { class: 'card-solid', style: 'border-style:dashed;opacity:0.85' },
          h('div', { style: 'display:flex;align-items:center;gap:10px' },
            h('span', { style: 'font-weight:800' }, name),
            badge('soon', 'pending')),
          h('p', { style: 'color:var(--text-3);font-size:13.5px;margin-top:6px' }, desc),
        ))),
      h('p', { class: 'stat-sub', style: 'margin-top:16px' },
        'Impatient? Most of this already works through chat — ask Social Agents to "schedule the week from content-library/" or "post this clip everywhere" today.'),
    );
  },
};
