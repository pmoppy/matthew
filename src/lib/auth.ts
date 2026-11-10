/**
 * Test sign-in: one shared username and password for people trialling the app.
 *
 * This is a lock on the front door, not a safe. It stops casual use of the
 * app and web link, but the app code and the product library are still
 * publicly downloadable from GitHub, so it is not real security. For that,
 * put the web app behind Cloudflare Access and make the repository private.
 *
 * Only a hash of the login is stored here. To change it, replace the hash with
 * sha256("shelfscan-v1:<username in lower case>:<password>").
 */
const LOGINS = new Set([
  'e7e0ea78274796dcf923075bbe67f7a95af8e7585288b170bdb9ad9bea40b524', // tester
  '4d19303a72b50c2ab3cef1fae0fe076207eedfa61942205343a1fed151cf4e93', // matt
  '6a339d472b86b87e345d4f5721a54bb743cf11ca47c90189e13372c7f5d2e980', // panko
]);
const KEY = 'shelfscan.signedIn';

async function hash(user: string, pass: string): Promise<string> {
  const data = new TextEncoder().encode(`shelfscan-v1:${user.trim().toLowerCase()}:${pass}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function signedInAs(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { user: string; h: string } | null;
    return v && LOGINS.has(v.h) ? v.user : null;
  } catch {
    return null;
  }
}

export async function signIn(user: string, pass: string): Promise<boolean> {
  const h = await hash(user, pass);
  if (!LOGINS.has(h)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ user: user.trim(), h }));
  } catch {
    /* private mode: signed in for this visit only */
  }
  return true;
}

export function signOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
