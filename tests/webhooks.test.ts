import { describe, expect, it } from 'vitest';
import { signatureHeader, signPayload, verifySignature } from '../src/webhooks/receiver.js';

describe('webhook signature verification (X-CreatorOS-Signature)', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_7Hq2', type: 'comment.received', created: 1727290000 });
  const now = 1727290000;

  it('accepts a correctly signed body', () => {
    expect(verifySignature(body, secret, signatureHeader(body, secret, now), now)).toBe(true);
  });

  it('signs "<t>.<raw body>" with HMAC-SHA256, hex', () => {
    const header = signatureHeader(body, secret, now);
    expect(header).toBe(`t=${now},v1=${signPayload(body, secret, now)}`);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('rejects a tampered body', () => {
    const header = signatureHeader(body, secret, now);
    expect(verifySignature(body + 'x', secret, header, now)).toBe(false);
  });

  it('rejects a timestamp swapped onto an old signature', () => {
    const v1 = signPayload(body, secret, now);
    expect(verifySignature(body, secret, `t=${now + 1},v1=${v1}`, now)).toBe(false);
  });

  it('rejects signatures older (or newer) than 5 minutes', () => {
    const header = signatureHeader(body, secret, now);
    expect(verifySignature(body, secret, header, now + 300)).toBe(true);
    expect(verifySignature(body, secret, header, now + 301)).toBe(false);
    expect(verifySignature(body, secret, header, now - 301)).toBe(false);
  });

  it('rejects a missing, malformed, or wrong signature', () => {
    expect(verifySignature(body, secret, undefined, now)).toBe(false);
    expect(verifySignature(body, secret, 'deadbeef', now)).toBe(false);
    expect(verifySignature(body, secret, `t=${now}`, now)).toBe(false);
    expect(verifySignature(body, secret, `t=${now},v1=deadbeef`, now)).toBe(false);
    expect(verifySignature(body, 'whsec_wrong', signatureHeader(body, secret, now), now)).toBe(false);
  });

  it('accepts when any of several v1 signatures matches (secret rotation)', () => {
    const good = signPayload(body, secret, now);
    expect(verifySignature(body, secret, `t=${now},v1=${'0'.repeat(64)},v1=${good}`, now)).toBe(true);
  });
});
