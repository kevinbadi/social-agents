#!/usr/bin/env node
// The `social-agents` command — open a Social Agents session from any terminal, anywhere.
// Register it once with `npm link` (from this repo), then just type `social-agents`.
//
// Sessions do NOT merge: each terminal is its own conversation with its
// own memory. What every session DOES share is the workspace — social-agents/
// brand pack, config, credentials, content-library/ — because the command
// always anchors to this install's directory, not the shell's cwd.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same first-run safety net as npm start: install deps if they're missing.
const deps = spawnSync(process.execPath, [join(root, 'scripts', 'ensure-deps.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (deps.status !== 0) process.exit(deps.status ?? 1);

// `social-agents` → the chat; `social-agents dashboard` → mission control in the browser.
const sub = (process.argv[2] ?? 'social-agents').toLowerCase();
const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const run = spawnSync(tsx, [join(root, 'src', 'index.ts'), 'creatoros', sub], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(run.status ?? 0);
