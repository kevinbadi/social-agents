import { describe, expect, it } from 'vitest';
import { routeArgs, usage } from '../src/index.js';

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

  it('usage mentions both invocations', () => {
    expect(usage()).toContain('creatoros social-agents');
    expect(usage()).toContain('creatoros dashboard');
  });
});
