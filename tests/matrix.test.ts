import { describe, expect, it } from 'vitest';
import {
  assertCommentDeleteSupported,
  assertCommentHideSupported,
  assertCommentLikeSupported,
  assertCommentReplySupported,
  assertFunnelSupported,
  assertMessageReplySupported,
  normalizePlatform,
  PlatformNotSupportedError,
  supportsCommentDelete,
  supportsCommentHide,
  supportsCommentLike,
  supportsCommentReplies,
  supportsMessageReplies,
} from '../src/client/platformMatrix.js';
import { CreatorOSClient } from '../src/client/client.js';

describe('platform matrix — comments', () => {
  it('refuses TikTok comment replies with a friendly message, never a raw API error', () => {
    expect(() => assertCommentReplySupported('tiktok')).toThrowError(PlatformNotSupportedError);
    expect(() => assertCommentReplySupported('tiktok')).toThrowError(
      /not supported on this platform/,
    );
  });

  it('refuses the other no-comment platforms too', () => {
    for (const platform of ['pinterest', 'bluesky', 'reddit', 'telegram']) {
      expect(supportsCommentReplies(platform)).toBe(false);
    }
  });

  it('allows the supported comment platforms', () => {
    for (const platform of ['facebook', 'instagram', 'twitter', 'threads', 'youtube', 'linkedin']) {
      expect(() => assertCommentReplySupported(platform)).not.toThrow();
    }
  });
});

describe('platform matrix — comment hiding', () => {
  it('allows Facebook, Instagram, Threads, and Twitter/X (incl. the x alias)', () => {
    for (const platform of ['facebook', 'instagram', 'threads', 'twitter', 'x']) {
      expect(() => assertCommentHideSupported(platform)).not.toThrow();
    }
  });

  it('refuses the rest with a friendly message', () => {
    for (const platform of ['tiktok', 'youtube', 'linkedin', 'reddit', 'bluesky', 'pinterest']) {
      expect(supportsCommentHide(platform)).toBe(false);
    }
    expect(() => assertCommentHideSupported('reddit')).toThrowError(PlatformNotSupportedError);
    expect(() => assertCommentHideSupported('reddit')).toThrowError(/not supported on/);
  });
});

describe('platform matrix — comment likes', () => {
  it('allows Facebook and Twitter/X', () => {
    for (const platform of ['facebook', 'twitter', 'x']) {
      expect(() => assertCommentLikeSupported(platform)).not.toThrow();
    }
  });

  it('refuses the rest — notably Instagram', () => {
    for (const platform of ['instagram', 'tiktok', 'threads', 'youtube', 'linkedin']) {
      expect(supportsCommentLike(platform)).toBe(false);
    }
    expect(() => assertCommentLikeSupported('instagram')).toThrowError(PlatformNotSupportedError);
  });
});

describe('platform matrix — comment deletion', () => {
  it('allows Facebook, Instagram, YouTube, and LinkedIn', () => {
    for (const platform of ['facebook', 'instagram', 'youtube', 'linkedin']) {
      expect(() => assertCommentDeleteSupported(platform)).not.toThrow();
    }
  });

  it('refuses the rest', () => {
    for (const platform of ['tiktok', 'twitter', 'threads', 'pinterest']) {
      expect(supportsCommentDelete(platform)).toBe(false);
    }
    expect(() => assertCommentDeleteSupported('twitter')).toThrowError(/not supported on/);
  });
});

describe('platform matrix — messages', () => {
  it('allows DM platforms', () => {
    for (const platform of ['twitter', 'instagram', 'facebook']) {
      expect(() => assertMessageReplySupported(platform)).not.toThrow();
    }
  });

  it('refuses DM-less platforms', () => {
    for (const platform of ['tiktok', 'youtube', 'threads', 'linkedin', 'pinterest']) {
      expect(supportsMessageReplies(platform)).toBe(false);
    }
  });
});

describe('platform matrix — funnels', () => {
  it('funnels are Instagram/Facebook only', () => {
    expect(() => assertFunnelSupported('instagram')).not.toThrow();
    expect(() => assertFunnelSupported('facebook')).not.toThrow();
    expect(() => assertFunnelSupported('twitter')).toThrowError(/Instagram and Facebook only/);
    expect(() => assertFunnelSupported('tiktok')).toThrowError(PlatformNotSupportedError);
  });
});

describe('platform aliases', () => {
  it('normalizes common aliases', () => {
    expect(normalizePlatform('X')).toBe('twitter');
    expect(normalizePlatform('IG')).toBe('instagram');
    expect(normalizePlatform('YouTube')).toBe('youtube');
  });
});

describe('matrix enforced inside the client (executor, not prompt discipline)', () => {
  const neverFetch: typeof fetch = () => {
    throw new Error('network should never be reached');
  };
  const client = new CreatorOSClient({ apiKey: 'cos_live_' + 'a'.repeat(32), fetchImpl: neverFetch });

  it('TikTok comment reply is refused before any network call', async () => {
    await expect(
      client.replyToComment({ platform: 'tiktok', postId: 'p', accountId: 'a', message: 'hi' }),
    ).rejects.toThrow(/not supported on this platform/);
  });

  it('Threads DM is refused before any network call', async () => {
    await expect(
      client.sendMessage({ platform: 'threads', conversationId: 'c', accountId: 'a', message: 'hi' }),
    ).rejects.toThrow(/not supported on this platform/);
  });

  it('YouTube comment hide is refused before any network call', async () => {
    await expect(
      client.hideComment({ platform: 'youtube', postId: 'p', commentId: 'c', accountId: 'a' }),
    ).rejects.toThrow(PlatformNotSupportedError);
  });

  it('Instagram comment like is refused before any network call', async () => {
    await expect(
      client.likeComment({ platform: 'instagram', postId: 'p', commentId: 'c', accountId: 'a' }),
    ).rejects.toThrow(PlatformNotSupportedError);
  });

  it('Twitter comment delete is refused before any network call', async () => {
    await expect(
      client.deleteComment({ platform: 'twitter', postId: 'p', commentId: 'c', accountId: 'a' }),
    ).rejects.toThrow(PlatformNotSupportedError);
  });
});
