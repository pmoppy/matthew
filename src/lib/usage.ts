import { signedInHash } from './auth';

/**
 * Usage log: small notes ("ed scanned Bob's Minimart") sent to the ShelfScan
 * usage Worker on Cloudflare (worker-usage/), so the admin can see who uses
 * the app. Never photos. Notes are queued on the device and sent when online.
 */
export const USAGE_URL: string = (import.meta.env.VITE_USAGE_URL as string | undefined)?.trim() || 'https://shelfscan-usage.shelfscan.workers.dev';
const QUEUE = 'shelfscan.usageQueue';

export type UsageType = 'sign_in' | 'app_open' | 'scan' | 'planogram_check' | 'media_open' | 'pdf_report' | 'coupons_added' | 'basket_sent';

interface Note {
  h: string;
  type: UsageType;
  detail?: string;
  app: string;
  device: string;
  at: number;
}

function device(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Other';
}

function readQueue(): Note[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as Note[];
  } catch {
    return [];
  }
}

function writeQueue(q: Note[]) {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q.slice(-200)));
  } catch {
    /* ignore */
  }
}

let flushing = false;
let again = false;

/** Send queued notes; keeps them for later when offline. */
export async function flushUsage(): Promise<void> {
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    // Re-read the queue each time: notes can be added while one is being sent.
    for (let note = readQueue()[0]; note; note = readQueue()[0]) {
      let res: Response;
      try {
        res = await fetch(`${USAGE_URL}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note), keepalive: true });
      } catch {
        break; // offline: try again next time
      }
      if (res.status >= 500) break;
      // Sent (or rejected for good, e.g. an old login): drop exactly this note.
      const sent = note;
      writeQueue(readQueue().filter((n) => !(n.at === sent.at && n.type === sent.type && n.h === sent.h)));
    }
  } finally {
    flushing = false;
  }
  if (again) {
    again = false;
    return flushUsage();
  }
}

export function track(type: UsageType, detail?: string) {
  const h = signedInHash();
  if (!h) return;
  writeQueue([...readQueue(), { h, type, detail: detail?.slice(0, 500), app: __NATIVE__ ? 'Android app' : 'Web', device: device(), at: Date.now() }]);
  void flushUsage();
}

/** One "opened the app" note per half hour, so a busy day reads sensibly. */
export function trackOpen() {
  const KEY = 'shelfscan.lastOpenNote';
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30 * 60e3) return void flushUsage();
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  track('app_open');
}

export interface UsageEvent {
  u: string;
  t: UsageType | string;
  d: string;
  a: string;
  v: string;
  at: number;
}

export async function fetchUsage(user: string, pass: string): Promise<UsageEvent[]> {
  const res = await fetch(`${USAGE_URL}/events?limit=2000`, { headers: { 'x-admin-user': user, 'x-admin-pass': pass } });
  if (res.status === 403) throw new Error('Wrong admin password.');
  if (!res.ok) throw new Error(`Usage log returned ${res.status}`);
  return ((await res.json()) as { events: UsageEvent[] }).events;
}
