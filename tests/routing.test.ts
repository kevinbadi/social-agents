import { describe, expect, it } from 'vitest';
import { routeArgs, usage } from '../src/index.js';

describe('arg routing', () => {
  it('routes `creatoros midas`', () => {
    expect(routeArgs(['creatoros', 'midas'])).toBe('midas');
  });

  it('routes the `midas` alias', () => {
    expect(routeArgs(['creatoros', 'midas'])).toBe('midas');
  });

  it('is case-insensitive on the command', () => {
    expect(routeArgs(['creatoros', 'Midas'])).toBe('midas');
    expect(routeArgs(['creatoros', 'MIDAS'])).toBe('midas');
  });

  it('tolerates the npm `--` separator', () => {
    expect(routeArgs(['--', 'creatoros', 'midas'])).toBe('midas');
  });

  it('falls back to usage for anything else', () => {
    expect(routeArgs([])).toBe('usage');
    expect(routeArgs(['creatoros'])).toBe('usage');
    expect(routeArgs(['creatoros', 'init'])).toBe('usage');
    expect(routeArgs(['midas'])).toBe('usage');
  });

  it('usage mentions both invocations', () => {
    expect(usage()).toContain('creatoros midas');
    expect(usage()).toContain('creatoros midas');
  });
});
