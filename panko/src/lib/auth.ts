/** Password check against the Panko server. The server refuses every AI request without it. */

/** "Use my own API key" is a developer convenience only; real builds always go through the server. */
export const ALLOW_OWN_KEY = import.meta.env.DEV;
export const BUILT_IN_SERVER = import.meta.env.VITE_PANKO_SERVER || '';

export type AuthResult = 'ok' | 'wrong' | 'offline' | 'server-error';

export async function checkPassword(serverUrl: string, password: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/auth`, {
      method: 'POST',
      headers: { 'x-panko-access': password },
    });
    if (res.ok) return 'ok';
    if (res.status === 403) return 'wrong';
    return 'server-error';
  } catch {
    return 'offline';
  }
}
