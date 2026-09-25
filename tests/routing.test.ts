import { describe, expect, it } from 'vitest';
import { requestedWorkspace, routeArgs, usage } from '../src/index.js';

describe('arg routing', () => {
  it('routes `creatoros social-agents`', () => {
    expect(routeArgs(['creatoros', 'social-agents'])).toBe('social-agents');
  });

  it('routes `creatoros social agents` as two words', () => {
    expect(routeArgs(['creatoros', 'social', 'agents'])).toBe('social-agents');
  });

  it('still routes the pre-rename `midas` command', () => {
    expect(routeArgs(['creatoros', 'midas'])).toBe('social-agents');
  });

  it('is case-insensitive on the command', () => {
    expect(routeArgs(['creatoros', 'Social-Agents'])).toBe('social-agents');
    expect(routeArgs(['creatoros', 'SOCIAL', 'AGENTS'])).toBe('social-agents');
  });

  it('tolerates the npm `--` separator', () => {
    expect(routeArgs(['--', 'creatoros', 'social-agents'])).toBe('social-agents');
  });

  it('falls back to usage for anything else', () => {
    expect(routeArgs([])).toBe('usage');
    expect(routeArgs(['creatoros'])).toBe('usage');
    expect(routeArgs(['creatoros', 'init'])).toBe('usage');
    expect(routeArgs(['social-agents'])).toBe('usage');
  });

  it('routes `creatoros add` (another API key = another workspace)', () => {
    expect(routeArgs(['creatoros', 'add'])).toBe('add');
  });

  it('reads the workspace to open from the args, then SOCIAL_AGENTS_WORKSPACE', () => {
    expect(requestedWorkspace(['creatoros', 'social-agents', 'acme-fitness'], {})).toBe('acme-fitness');
    expect(requestedWorkspace(['creatoros', 'social', 'agents', 'Acme', 'Fitness'], {})).toBe('Acme Fitness');
    expect(requestedWorkspace(['creatoros', 'social-agents'], { SOCIAL_AGENTS_WORKSPACE: 'bolt' })).toBe('bolt');
    expect(requestedWorkspace(['creatoros', 'social-agents'], {})).toBeUndefined();
    expect(requestedWorkspace(['creatoros', 'dashboard'], {})).toBeUndefined();
  });

  it('usage mentions both invocations', () => {
    expect(usage()).toContain('creatoros social-agents');
    expect(usage()).toContain('creatoros dashboard');
    expect(usage()).toContain('creatoros add');
  });
});
