import { createStore, del, getMany, keys, set } from 'idb-keyval';
import { canvasToBlob } from './image';

/**
 * Audit log of every change a rep makes to a scan result: what the app said,
 * what the rep chose, when, where, and the photo of the pack. Kept on the
 * phone and exported by the admin (CSV + photos).
 */
const store = createStore('shelfscan-changelog', 'v1');
const MAX = 2000;

export type ChangeAction = 'confirmed' | 'corrected' | 'marked_empty';

export interface ChangeEntry {
  id: string;
  at: number;
  device: string;
  store?: string;
  scanId?: string;
  bay?: string;
  action: ChangeAction;
  /** What the app said before the rep touched it. */
  appProduct: string | null;
  appConfidence: number;
  appStatus: string;
  /** The rep's choice (null when marked as an empty space / not a product). */
  repProduct: string | null;
  /** Next-best guesses the app offered. */
  alternatives: string[];
  crop: Blob;
}

/** Anonymous id for this phone, so changes from different reps can be told apart. */
export function deviceId(): string {
  const KEY = 'shelfscan.deviceId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `phone-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'phone-unknown';
  }
}

export async function logChange(e: Omit<ChangeEntry, 'id' | 'at' | 'device' | 'crop'> & { crop: HTMLCanvasElement }) {
  const at = Date.now();
  const id = `${at}-${Math.random().toString(36).slice(2, 6)}`;
  const crop = await canvasToBlob(e.crop, 'image/jpeg', 0.85);
  await set(id, { ...e, id, at, device: deviceId(), crop } satisfies ChangeEntry, store);
  const ks = (await keys(store)).map(String).sort();
  for (const k of ks.slice(0, Math.max(0, ks.length - MAX))) await del(k, store);
}

export async function listChanges(): Promise<ChangeEntry[]> {
  const ks = await keys(store);
  const vals = ((await getMany(ks, store)) as (ChangeEntry | undefined)[]).filter((v): v is ChangeEntry => !!v);
  return vals.sort((a, b) => b.at - a.at);
}

export async function clearChanges() {
  for (const k of await keys(store)) await del(k, store);
}


function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safe(name: string) {
  return name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/** ZIP with rep-changes.csv and every pack photo (photos/<id>.jpg), oldest first. */
export async function exportChangesZip(): Promise<{ zip: Blob; count: number } | null> {
  const all = (await listChanges()).reverse();
  if (!all.length) return null;
  const { zipSync } = await import('fflate');
  const header = ['change_id', 'date', 'time', 'device', 'store', 'scan_id', 'bay', 'action', 'app_said', 'app_confidence', 'app_status', 'rep_chose', 'other_options', 'changed', 'photo'];
  const lines = [header.join(',')];
  const files: Record<string, Uint8Array> = {};
  for (const c of all) {
    const d = new Date(c.at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const photo = `photos/${c.id}-${safe(c.repProduct ?? 'empty')}.jpg`;
    files[photo] = new Uint8Array(await c.crop.arrayBuffer());
    const changed = c.action !== 'confirmed' ? 'yes' : 'no';
    lines.push(
      [c.id, date, time, c.device, c.store, c.scanId, c.bay, c.action, c.appProduct ?? '', c.appConfidence ? c.appConfidence.toFixed(2) : '', c.appStatus, c.repProduct ?? '(empty space)', c.alternatives.join(' | '), changed, photo]
        .map(cell)
        .join(','),
    );
  }
  files['rep-changes.csv'] = new TextEncoder().encode(lines.join('\n') + '\n');
  return { zip: new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), count: all.length };
}
