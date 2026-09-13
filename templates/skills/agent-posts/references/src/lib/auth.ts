// Single-user password gate. No external auth provider — just you.
// Works in both the Edge proxy (middleware) and Node server via Web Crypto.

export const SESSION_COOKIE = "mos_session";

function secret(): string {
  return process.env.APP_AUTH_SECRET || "marketing-os-dev-secret";
}

function password(): string {
  return process.env.APP_PASSWORD || "";
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic session token derived from the password + secret. */
export async function sessionToken(): Promise<string> {
  return sha256(`${password()}::${secret()}`);
}

/** Validate a cookie value against the expected token. */
export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token || !password()) return false;
  return token === (await sessionToken());
}

/** Constant-time-ish check of a submitted password. */
export function passwordMatches(input: string): boolean {
  const pw = password();
  return pw.length > 0 && input === pw;
}

/** Whether a password gate is configured at all. */
export const authConfigured = Boolean(process.env.APP_PASSWORD);
