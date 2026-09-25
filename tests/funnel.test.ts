import { describe, expect, it } from 'vitest';
import { buildFunnelAutomation, describeFunnel } from '../src/automations/funnels.js';

const base = {
  platform: 'instagram',
  accountId: 'acc_9f2kd81lq0',
  name: 'launch-funnel',
  keywords: ['LINK', 'GUIDE'],
  dmMessage: 'Here it is — thanks for the comment!',
  link: 'https://shop.example/guide',
};

describe('funnel config generation', () => {
  it('builds a valid automation body from the interview answers', () => {
    const body = buildFunnelAutomation(base);
    expect(body).toEqual({
      accountId: 'acc_9f2kd81lq0',
      name: 'launch-funnel',
      keywords: ['LINK', 'GUIDE'],
      matchMode: 'contains',
      dmMessage: `${base.dmMessage}\n\nhttps://shop.example/guide`,
    });
    // Account-wide, and no profile concept: a key is pinned to one workspace.
    expect(body).not.toHaveProperty('platformPostId');
    expect(body).not.toHaveProperty('profileId');
  });

  it('does not repeat a link the DM already contains', () => {
    const body = buildFunnelAutomation({ ...base, dmMessage: 'Grab it: https://shop.example/guide' });
    expect(body.dmMessage).toBe('Grab it: https://shop.example/guide');
  });

  it('scopes to a single post by the network post id', () => {
    const body = buildFunnelAutomation({ ...base, platformPostId: '17912345678901234' });
    expect(body.platformPostId).toBe('17912345678901234');
  });

  it('carries matchMode and the optional public comment reply', () => {
    const body = buildFunnelAutomation({ ...base, matchMode: 'word', commentReply: 'Check your DMs!' });
    expect(body.matchMode).toBe('word');
    expect(body.commentReply).toBe('Check your DMs!');
  });

  it('rejects non-IG/FB platforms', () => {
    expect(() => buildFunnelAutomation({ ...base, platform: 'twitter' })).toThrow(
      /Instagram and Facebook only/,
    );
  });

  it('rejects an empty DM message and blank keywords', () => {
    expect(() => buildFunnelAutomation({ ...base, dmMessage: '  ' })).toThrow(/DM message/);
    expect(() => buildFunnelAutomation({ ...base, keywords: ['ok', ' '] })).toThrow(/non-empty/);
  });

  it('describes the funnel for human sign-off (keyword + DM copy visible)', () => {
    const description = describeFunnel(base);
    expect(description).toContain('"LINK"');
    expect(description).toContain(base.dmMessage);
    expect(description).toContain('https://shop.example/guide');
  });
});
