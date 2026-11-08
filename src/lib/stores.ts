/** Sample stores for testing. Later this list can come from the catalogue (e.g. stores.csv in R2). */
export const STORES = [
  "Bob's Minimart",
  'Corner Shop Express',
  'Patel News & Booze',
  'Village Stores',
  'Station Road Convenience',
];

const KEY = 'shelfscan.lastStore';

export function loadStore(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveStore(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
}
