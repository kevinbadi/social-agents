import { describe, expect, it, vi } from 'vitest';
import { CreatorOSClient } from '../src/client/client.js';
import {
  annotateOwnComments,
  annotateOwnMessages,
  isOwnMessage,
  OWN_COMMENT_MARKER,
  OWN_MESSAGE_MARKER,
  SelfReplyBlockedError,
} from '../src/client/selfGuard.js';

const KEY = 'cos_live_' + 'ab'.repeat(16);

function clientWith(responses: unknown[]): { client: CreatorOSClient; impl: ReturnType<typeof vi.fn> } {
  const impl = vi.fn();
  for (const body of responses) {
    impl.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  return { client: new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch }), impl };
}

// The live GET /v1/inbox/comments/:postId shape: the own flag lives on `from`.
const COMMENTS_PAYLOAD = {
  status: 'success',
  comments: [
    { id: 'cmt_own1', message: 'thanks for watching!', from: { id: 'obj_brand', username: 'brand', isOwner: true } },
    {
      id: 'cmt_fan1',
      message: 'love this',
      from: { id: 'obj_fan', username: 'superfan', isOwner: false },
      replies: [{ id: 'cmt_own2', message: 'appreciate you!', from: { id: 'obj_brand', username: 'brand', isOwner: true } }],
    },
  ],
};

describe('comment self-reply loop breaker', () => {
  it('annotates own comments (top-level and nested) and collects their ids', () => {
    const payload = structuredClone(COMMENTS_PAYLOAD);
    const ownIds = annotateOwnComments(payload);
    expect([...ownIds].sort()).toEqual(['cmt_own1', 'cmt_own2']);
    expect(payload.comments[0]!.message).toContain(OWN_COMMENT_MARKER);
    expect(payload.comments[1]!.replies![0]!.message).toContain(OWN_COMMENT_MARKER);
    expect(payload.comments[1]!.message).not.toContain(OWN_COMMENT_MARKER);
  });

  it('blocks replying to an own comment seen in a fetch — the cron loop scenario', async () => {
    const { client, impl } = clientWith([COMMENTS_PAYLOAD]);
    await client.getPostComments('post_1', { accountId: 'acc_1' });
    await expect(
      client.replyToComment({ platform: 'instagram', postId: 'post_1', accountId: 'acc_1', message: 'hi', commentId: 'cmt_own1' }),
    ).rejects.toThrow(SelfReplyBlockedError);
    await expect(
      client.replyToComment({ platform: 'instagram', postId: 'post_1', accountId: 'acc_1', message: 'hi', commentId: 'cmt_own2' }),
    ).rejects.toThrow(/your own comment/i);
    expect(impl).toHaveBeenCalledTimes(1); // only the fetch — no reply reached the network
  });

  it('still allows replying to a real fan comment after the same fetch', async () => {
    const { client, impl } = clientWith([COMMENTS_PAYLOAD, { reply: { id: 'r1' } }]);
    await client.getPostComments('post_1', { accountId: 'acc_1' });
    await client.replyToComment({ platform: 'instagram', postId: 'post_1', accountId: 'acc_1', message: 'thanks!', commentId: 'cmt_fan1' });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('blocks private replies to own comments too', async () => {
    const { client } = clientWith([COMMENTS_PAYLOAD]);
    await client.getPostComments('post_1', { accountId: 'acc_1' });
    await expect(
      client.privateReplyToComment({ platform: 'instagram', postId: 'post_1', commentId: 'cmt_own1', accountId: 'acc_1', message: 'psst' }),
    ).rejects.toThrow(SelfReplyBlockedError);
  });

  it('learns own ids from list_comments payloads as well', async () => {
    const { client } = clientWith([
      { data: [{ id: 'post_1', comments: [{ id: 'cmt_own9', message: 'my reply', from: { isOwner: true } }] }] },
    ]);
    await client.listComments();
    await expect(
      client.replyToComment({ platform: 'facebook', postId: 'post_1', accountId: 'acc_1', message: 'hi', commentId: 'cmt_own9' }),
    ).rejects.toThrow(SelfReplyBlockedError);
  });
});

describe('message auto-response loop breaker', () => {
  const conversation = (latest: 'own' | 'theirs') => ({
    messages: [
      { id: 'msg_1', message: 'hey, is the guide still available?', direction: 'incoming', createdAt: '2026-07-18T10:00:00Z' },
      {
        id: 'msg_2',
        message: 'Yes! Here you go.',
        direction: 'outgoing',
        createdAt: latest === 'own' ? '2026-07-18T11:00:00Z' : '2026-07-18T09:00:00Z',
      },
    ],
  });

  it('recognizes the self flags the platforms actually use', () => {
    for (const message of [
      { isSelf: true },
      { isOwner: true },
      { fromMe: true },
      { isFromMe: true },
      { isEcho: true },
      { is_echo: true },
      { direction: 'outgoing' },
      { direction: 'outbound' },
      { direction: 'SENT' },
      { from: { isSelf: true } },
    ]) {
      expect(isOwnMessage(message)).toBe(true);
    }
    expect(isOwnMessage({ direction: 'incoming' })).toBe(false);
    expect(isOwnMessage({ direction: 'inbound' })).toBe(false);
    expect(isOwnMessage({ text: 'hi' })).toBe(false);
  });

  it('annotates own messages and reports whether the newest is own', () => {
    const own = conversation('own');
    expect(annotateOwnMessages(own)).toBe(true);
    expect(own.messages[1]!.message).toContain(OWN_MESSAGE_MARKER);
    expect(own.messages[0]!.message).not.toContain(OWN_MESSAGE_MARKER);
    expect(annotateOwnMessages(conversation('theirs'))).toBe(false);
  });

  it('returns null (unknown) without usable timestamps — unknown never blocks', () => {
    expect(annotateOwnMessages({ messages: [{ text: 'a' }, { text: 'b', isSelf: true }] })).toBe(null);
  });

  it('blocks replying to a conversation whose latest message is your own — the cron loop scenario', async () => {
    const { client, impl } = clientWith([conversation('own')]);
    await client.getConversationMessages('conv_1', { accountId: 'acc_1' });
    await expect(
      client.sendMessage({ platform: 'instagram', conversationId: 'conv_1', accountId: 'acc_1', message: 'hello again' }),
    ).rejects.toThrow(SelfReplyBlockedError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('allows the reply when the latest message is theirs, then blocks an immediate double-send', async () => {
    const { client, impl } = clientWith([conversation('theirs'), { message: { id: 'm3' } }]);
    await client.getConversationMessages('conv_1', { accountId: 'acc_1' });
    await client.sendMessage({ platform: 'instagram', conversationId: 'conv_1', accountId: 'acc_1', message: 'yes!' });
    expect(impl).toHaveBeenCalledTimes(2);
    // The send itself marks the conversation as ours — no double-texting in the same run.
    await expect(
      client.sendMessage({ platform: 'instagram', conversationId: 'conv_1', accountId: 'acc_1', message: 'also…' }),
    ).rejects.toThrow(/answer yourself/i);
  });

  it('allowFollowUp is the explicit human-approved escape hatch', async () => {
    const { client, impl } = clientWith([conversation('own'), { message: { id: 'm3' } }]);
    await client.getConversationMessages('conv_1', { accountId: 'acc_1' });
    await client.sendMessage({
      platform: 'instagram',
      conversationId: 'conv_1',
      accountId: 'acc_1',
      message: 'following up as you asked',
      allowFollowUp: true,
    });
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
