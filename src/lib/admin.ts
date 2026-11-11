import { signedInAs } from './auth';

const KEY = 'shelfscan.admin';

/** Accounts allowed into the admin area (catalogue, settings, usage log). */
const ADMINS = new Set(['matt']);

export function isAdminUser(): boolean {
  return ADMINS.has((signedInAs() ?? '').trim().toLowerCase());
}

/**
 * Admin mode shows the Catalogue and Settings screens. Field users never see
 * them. Only admin accounts (matt) can turn it on: the Admin button in the top
 * bar, ?admin=1, or tapping the logo 7 times.
 */
export function readAdminMode(): boolean {
  if (!isAdminUser()) return false;
  try {
    const p = new URLSearchParams(location.search).get('admin');
    if (p !== null) {
      if (p === '0' || p === 'off') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '1');
      const url = new URL(location.href);
      url.searchParams.delete('admin');
      history.replaceState(null, '', url);
    }
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function leaveAdminMode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function enterAdminMode() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}
