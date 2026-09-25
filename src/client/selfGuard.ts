/**
 * Self-reply loop protection. When engagement runs on a cron, the agent's
 * own replies come back in the next fetch looking like fresh comments and
 * messages — and an agent that answers them answers itself forever. The
 * guard works in two layers, both in code (not prompt discipline):
 *
 *  1. Fetches annotate every self-authored item with a loud marker so the
 *     model can't mistake it for a fan.
 *  2. The client remembers what it saw and hard-blocks replying to an own
 *     comment id, and messaging a conversation whose latest message is
 *     already the account's own.
 */

export const OWN_COMMENT_MARKER = '[YOUR OWN COMMENT — posted by this account. Never reply to it.]';
export const OWN_MESSAGE_MARKER = '[YOUR OWN MESSAGE — sent by this account. Not something to answer.]';

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Comments: CreatorOS sets `from.isOwner: true` on comments by the connected account. */
export function isOwnComment(comment: unknown): boolean {
  if (!isRec(comment)) return false;
  if (comment.isOwner === true) return true;
  return isRec(comment.from) && comment.from.isOwner === true;
}

/**
 * Messages: the self flag isn't uniform across platforms, so check every
 * spelling the platforms use. Conservative on purpose — a false "own"
 * would block a real reply, so only explicit flags count.
 */
export function isOwnMessage(message: unknown): boolean {
  if (!isRec(message)) return false;
  if (
    message.isOwner === true ||
    message.isSelf === true ||
    message.fromMe === true ||
    message.isFromMe === true ||
    message.isEcho === true ||
    message.is_echo === true
  ) {
    return true;
  }
  const direction = typeof message.direction === 'string' ? message.direction.toLowerCase() : '';
  if (direction === 'outbound' || direction === 'outgoing' || direction === 'sent') return true;
  const from = message.from;
  if (isRec(from) && (from.isOwner === true || from.isSelf === true)) return true;
  return false;
}

function prefixText(item: Rec, marker: string): void {
  for (const field of ['message', 'text', 'content']) {
    const value = item[field];
    if (typeof value === 'string' && !value.startsWith(marker)) {
      item[field] = `${marker} ${value}`;
      return;
    }
  }
  // No text field to prefix — still make the flag unmissable.
  item.selfAuthored = true;
}

/**
 * Walk a comments payload (any nesting of `comments`/`replies` arrays),
 * mark every own comment, and collect their ids for the reply block.
 * Mutates the freshly-parsed payload in place.
 */
export function annotateOwnComments(payload: unknown): Set<string> {
  const ownIds = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (!isRec(node)) return;
    if (isOwnComment(node)) {
      prefixText(node, OWN_COMMENT_MARKER);
      for (const idField of ['id', 'commentId']) {
        const id = node[idField];
        if (typeof id === 'string' && id) ownIds.add(id);
      }
    }
    // `from` is the author, not a comment: never walk into it.
    for (const [key, value] of Object.entries(node)) if (key !== 'from') walk(value);
  };
  walk(payload);
  return ownIds;
}

function messageTime(message: Rec): number | null {
  for (const field of ['createdAt', 'createdTime', 'timestamp', 'sentAt', 'date']) {
    const value = message[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Walk a conversation-messages payload, mark every own message, and say
 * whether the NEWEST message is the account's own. Newest is decided by
 * timestamp; without usable timestamps the answer is null (unknown), and
 * unknown never blocks — wrongly blocking a real reply is the worse bug.
 */
export function annotateOwnMessages(payload: unknown): boolean | null {
  const messages: Rec[] = [];
  const walk = (node: unknown, insideMessages: boolean): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, insideMessages);
      return;
    }
    if (!isRec(node)) return;
    if (insideMessages) messages.push(node);
    for (const [key, value] of Object.entries(node)) {
      walk(value, insideMessages || key === 'messages');
    }
  };
  walk(payload, Array.isArray(payload));

  let newest: Rec | null = null;
  let newestTime = -Infinity;
  for (const message of messages) {
    if (isOwnMessage(message)) prefixText(message, OWN_MESSAGE_MARKER);
    const time = messageTime(message);
    if (time !== null && time > newestTime) {
      newestTime = time;
      newest = message;
    }
  }
  if (messages.length === 0 || newest === null) return null;
  return isOwnMessage(newest);
}

export class SelfReplyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfReplyBlockedError';
  }
}
