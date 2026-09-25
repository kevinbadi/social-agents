/**
 * Inbound events (new comment / new message) arrive via CreatorOS webhooks.
 * Railway receives them natively; on the local pathway this lightweight
 * receiver can run during a session, with inbox polling as the fallback
 * (the engagement-sweep cron polls, so nothing is lost when it's offline).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/** `X-CreatorOS-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` */
const SIGNATURE_HEADER = 'x-creatoros-signature';
/** Signatures older than this are replays. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** Hex HMAC-SHA256 of `"<t>.<raw body>"`, keyed by the endpoint secret (whsec_...). */
export function signPayload(rawBody: string | Buffer, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/** Build a header value the way CreatorOS does (tests and local replays). */
export function signatureHeader(rawBody: string | Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${signPayload(rawBody, secret, timestamp)}`;
}

export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (!key || !value) continue;
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1') signatures.push(value.toLowerCase());
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

/**
 * Verify a CreatorOS webhook against the RAW request bytes: timing-safe
 * compare, and reject timestamps more than 5 minutes from now.
 */
export function verifySignature(
  rawBody: string | Buffer,
  secret: string,
  header: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signPayload(rawBody, secret, parsed.timestamp), 'utf8');
  return parsed.signatures.some((signature) => {
    const received = Buffer.from(signature, 'utf8');
    return received.length === expected.length && timingSafeEqual(expected, received);
  });
}

/** Event ids are prefixed (evt_); dedupe on them, delivery is at-least-once. */
export interface WebhookEvent {
  id?: string;
  type: string;
  created?: number;
  [key: string]: unknown;
}

export interface ReceiverOptions {
  port: number;
  secret?: string;
  onEvent: (event: WebhookEvent) => void | Promise<void>;
}

/** Start a minimal HTTP receiver. Returns the server (close() to stop). */
export function startReceiver(options: ReceiverOptions): Server {
  const seen = new Set<string>();
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (options.secret) {
        const header = req.headers[SIGNATURE_HEADER];
        const value = Array.isArray(header) ? header[0] : header;
        if (!verifySignature(raw, options.secret, value)) {
          res.writeHead(401).end();
          return;
        }
      }
      // Respond fast (CreatorOS requires 2xx within 4s), process after.
      res.writeHead(200).end();
      try {
        const event = JSON.parse(raw.toString('utf8')) as WebhookEvent;
        // At-least-once delivery — dedupe on event id.
        if (event.id) {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          if (seen.size > 5000) seen.clear();
        }
        void options.onEvent(event);
      } catch {
        // Unparseable body — already acked, nothing to process.
      }
    });
  });
  server.listen(options.port);
  return server;
}
