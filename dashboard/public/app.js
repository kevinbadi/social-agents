/**
 * Social Agents Dashboard shell — router, theme, data fetching, shared helpers.
 *
 * Panels live in panels/ — one file per panel, registered in
 * panels/registry.js. A panel is a plain object:
 *
 *   export default {
 *     id: 'my-panel',            // unique, used for nav + cache keys
 *     title: 'My Panel',         // sidebar label + page heading
 *     icon: '✦',                 // sidebar glyph
 *     route: '/my-panel',        // hash route (#/my-panel)
 *     fetchData: async () => fetch('/api/health').then(r => r.json()),
 *     render(root, data, ctx) {  // build DOM into root; ctx = helpers below
 *       root.append(ctx.h('div', { class: 'card-solid' }, 'hello'));
 *     },
 *   };
 *
 * The shell handles the rest: sidebar entry, routing, the full-page
 * spinner gate (no progressive pop-in), and stale-while-revalidate
 * (last payload cached in localStorage, painted instantly on revisit,
 * refreshed in the background).
 */
import { panels } from './panels/registry.js';

/* ------------------------------ helpers ------------------------------ */

/** Tiny hyperscript: h('div', {class:'card'}, child, 'text', ...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const esc = (s) => String(s ?? '');

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Status triple per Creator OS house rules: cyan good, silver idle, ink failed. */
export function statusClass(outcome) {
  if (outcome === 'failed') return 'st-fail';
  if (outcome === 'skipped' || outcome === 'pending') return 'st-idle';
  return 'st-good';
}
export const badge = (label, outcome) => h('span', { class: `badge ${statusClass(outcome)}` }, label);
export const dot = (outcome) => h('span', { class: `status-dot ${statusClass(outcome)}` });

/** Card with the uppercase micro-title every Creator OS card carries. */
export function card(title, ...children) {
  return h('div', { class: 'card-solid' }, title ? h('div', { class: 'card-title' }, title) : null, ...children);
}

/** Inline error card — a failed panel never takes the page down. */
export function errorCard(title, error) {
  return h('div', { class: 'card-solid error-card' },
    h('div', { class: 'card-title' }, title),
    h('div', {}, 'This panel could not load.'),
    h('div', { class: 'err-detail' }, String(error)),
  );
}

/** Dismissible note; dismissal persists in localStorage by id. */
export function note(id, text) {
  if (localStorage.getItem(`social-agents-note-${id}`)) return null;
  const el = h('div', { class: 'note' }, text,
    h('button', { class: 'note-x', 'aria-label': 'dismiss', onclick: () => { localStorage.setItem(`social-agents-note-${id}`, '1'); el.remove(); } }, '×'));
  return el;
}

/** Minimal markdown → DOM (headings, bold, code, lists, quotes, links, tables). */
export function md(text) {
  const container = h('div', { class: 'md' });
  const inline = (s) => esc(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>');
  const html = [];
  let list = null;
  for (const line of String(text ?? '').split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { if (!list) { list = []; } list.push(`<li>${inline(bullet[1])}</li>`); continue; }
    if (list) { html.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (heading) html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (line.startsWith('|')) html.push(`<p><code>${inline(line)}</code></p>`);
    else if (line.startsWith('>')) html.push(`<blockquote>${inline(line.slice(1).trim())}</blockquote>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (list) html.push(`<ul>${list.join('')}</ul>`);
  container.innerHTML = html.join('');
  return container;
}

/**
 * GitHub-style activity heatmap. data = [{date:'YYYY-MM-DD', count}] oldest
 * first; columns are weeks, rows Sun–Sat; the ramp comes from CSS vars so
 * it re-themes for free.
 */
export function heatmap(data) {
  const level = (count) => (count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4);
  const weeks = [];
  let week = null;
  for (const day of data) {
    const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    if (!week || dow === 0) { week = []; weeks.push(week); }
    while (week.length < dow) week.push(null); // pad the first partial week
    week.push(day);
  }
  const grid = h('div', { class: 'heatmap', role: 'img', 'aria-label': 'agent activity, one year' },
    weeks.map((w) => h('div', { class: 'hm-week' },
      Array.from({ length: 7 }, (_, i) => {
        const day = w[i];
        if (!day) return h('div', { class: 'hm-cell', style: 'visibility:hidden' });
        return h('div', { class: `hm-cell hm-${level(day.count)}`, title: `${day.date}: ${day.count} action${day.count === 1 ? '' : 's'}` });
      }),
    )),
  );
  const legend = h('div', { class: 'hm-legend' }, 'less',
    [0, 1, 2, 3, 4].map((i) => h('div', { class: `hm-cell hm-${i}` })), 'more');
  return h('div', {}, grid, legend);
}

/* --------------------------- workspaces ---------------------------- */
// One CreatorOS API key = one workspace (one set of socials). Every API call
// names the selected one; the server answers with that workspace's data only.

const WORKSPACE_KEY = 'social-agents-workspace';
let currentWorkspace = null;
try { currentWorkspace = localStorage.getItem(WORKSPACE_KEY); } catch { /* storage off — default workspace */ }

/** Append the selected workspace to an /api path. */
export function withWorkspace(path) {
  if (!currentWorkspace) return path;
  return `${path}${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(currentWorkspace)}`;
}

export async function api(path, options) {
  const res = await fetch(withWorkspace(path), options);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).error || detail; } catch { /* keep status */ }
    throw new Error(detail);
  }
  return res.json();
}

export const ctx = { h, esc, timeAgo, statusClass, badge, dot, card, errorCard, note, md, heatmap, api, withWorkspace };

/* ------------------------------ shell ------------------------------ */

const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
const spacer = sidebar.querySelector('.spacer');

for (const panel of panels) {
  sidebar.insertBefore(
    h('a', { class: 'nav-item', href: `#${panel.route}`, 'data-id': panel.id },
      h('span', { class: 'icon' }, panel.icon), panel.title),
    spacer,
  );
}

// Workspace switcher: one entry per CreatorOS API key.
const picker = document.getElementById('workspace-picker');
fetch('/api/workspaces').then((r) => r.json()).then(({ workspaces, default: fallback }) => {
  const stale = !workspaces.some((w) => w.slug === currentWorkspace);
  if (stale) currentWorkspace = fallback;
  if (!workspaces.length) return;
  if (stale) show(); // the saved choice is gone: repaint on the default
  picker.replaceChildren(...workspaces.map((w) =>
    h('option', { value: w.slug, ...(w.slug === currentWorkspace ? { selected: '' } : {}) }, w.name)));
  picker.hidden = false;
  picker.disabled = workspaces.length === 1;
}).catch(() => { /* no picker — the default workspace still renders */ });
picker.addEventListener('change', () => {
  currentWorkspace = picker.value;
  try { localStorage.setItem(WORKSPACE_KEY, currentWorkspace); } catch { /* per-visit only */ }
  show();
});

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('social-agents-theme', next);
});

function activePanel() {
  const route = location.hash.replace(/^#/, '') || '/';
  return panels.find((p) => p.route === route) ?? panels[0];
}

let renderToken = 0;

async function show() {
  const panel = activePanel();
  const token = ++renderToken;
  document.querySelectorAll('.nav-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === panel.id));

  const paint = (data) => {
    if (token !== renderToken) return; // user navigated away mid-fetch
    main.replaceChildren(
      h('h1', { class: 'page-title' }, panel.title),
      panel.subtitle ? h('div', { class: 'page-sub' }, panel.subtitle) : null,
    );
    panel.render(main, data, ctx);
  };

  if (!panel.fetchData) { paint(null); return; }

  // Stale-while-revalidate: cached payload paints instantly, then refresh.
  const cacheKey = `social-agents-cache-${currentWorkspace ?? 'default'}-${panel.id}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try { paint(JSON.parse(cached)); } catch { /* fall through to spinner */ }
  } else {
    // No pop-in: the CreatorOS mark pulses until the fetch settles.
    main.replaceChildren(h('div', { class: 'page-loading' },
      h('img', { class: 'spinner-logo', src: '/assets/creatoros-logo.png', alt: '', style: 'width:44px;height:44px' })));
  }
  try {
    const fresh = await panel.fetchData(ctx);
    try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch { /* quota — fine */ }
    paint(fresh);
  } catch (error) {
    if (cached) return; // stale view is better than an error page
    if (token !== renderToken) return;
    main.replaceChildren(
      h('h1', { class: 'page-title' }, panel.title),
      errorCard(panel.title, error.message),
    );
  }
}

window.addEventListener('hashchange', show);
show();
