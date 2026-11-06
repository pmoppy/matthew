const KEY = 'shelfscan.admin';

/**
 * Admin mode shows the Catalogue and Settings screens. Field users never see
 * them. Turn it on by opening the app once with ?admin=1 (and off with ?admin=0),
 * or in the Android app by tapping the logo 7 times.
 */
export function readAdminMode(): boolean {
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
