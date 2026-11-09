import { createStore, del, get, getMany, keys, set } from 'idb-keyval';
import { canvasToBlob } from './image';
import type { Facing } from './types';

/**
 * Scan history kept on the device. Each entry is a reduced photo (~1600 px,
 * ~0.3 MB) plus the boxes and labels, so 100 scans is roughly 30 MB.
 */
const metaStore = createStore('shelfscan-history-meta', 'v1');
const dataStore = createStore('shelfscan-history-data', 'v1');
const MAX_ENTRIES = 100;
const PHOTO_MAX_SIDE = 1600;

export interface HistoryMeta {
  id: string;
  at: number;
  /** e.g. "Energy & Sports bay" */
  bay: string;
  present: number;
  total: number;
  missing: number;
  facings: number;
  /** Number of photos in this bay scan (older entries: 1). */
  photos?: number;
  /** Small JPEG for the list. */
  thumb: Blob;
  /** Store name typed by the rep (optional). */
  store?: string;
  /** Per-product results at the time of the scan, for the CSV export. */
  rows?: ScanRow[];
  /** Media-hub planogram this bay was checked against, and the share of facings in place (0-1). */
  planogramId?: string;
  planogramScore?: number;
}

/** One product's result in one scan. */
export interface ScanRow {
  product: string;
  category?: string;
  rank?: number;
  /** on_shelf = top seller present; missing / to_check = top seller not confirmed; slow_seller / other = present, not a top seller. */
  result: 'on_shelf' | 'missing' | 'to_check' | 'slow_seller' | 'core' | 'other';
  facings: number;
}

/** One saved bay: one or more photos, each with its boxes and labels. */
interface HistoryData {
  photos?: Blob[];
  shots?: Facing[][];
  /** Older single-photo entries. */
  photo?: Blob;
  facings?: Facing[];
}

export interface SavedShot {
  image: HTMLCanvasElement;
  facings: Facing[];
}

function scaleCanvas(src: HTMLCanvasElement, maxSide: number): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}

function scaleFacings(facings: Facing[], factor: number): Facing[] {
  return facings.map((f) => ({ ...f, x1: f.x1 * factor, y1: f.y1 * factor, x2: f.x2 * factor, y2: f.y2 * factor }));
}

/** Save a bay scan (all its photos) and return its id; pass id to overwrite an existing entry. */
export async function saveScan(
  shots: SavedShot[],
  info: Pick<HistoryMeta, 'bay' | 'present' | 'total' | 'missing' | 'store' | 'rows' | 'planogramId' | 'planogramScore'>,
  id?: string,
): Promise<string> {
  const entryId = id ?? `${Date.now()}`;
  const existing = id ? ((await get(id, metaStore)) as HistoryMeta | undefined) : undefined;
  const photos: Blob[] = [];
  const saved: Facing[][] = [];
  for (const shot of shots) {
    const { canvas, scale } = scaleCanvas(shot.image, PHOTO_MAX_SIDE);
    photos.push(await canvasToBlob(canvas, 'image/jpeg', 0.82));
    saved.push(scaleFacings(shot.facings, scale));
  }
  const thumb = await canvasToBlob(scaleCanvas(shots[0].image, 240).canvas, 'image/jpeg', 0.7);
  const meta: HistoryMeta = {
    id: entryId,
    at: existing?.at ?? Date.now(),
    facings: shots.reduce((n, s) => n + s.facings.filter((f) => f.kind === 'product').length, 0),
    photos: shots.length,
    thumb,
    ...info,
  };
  await set(entryId, { photos, shots: saved } satisfies HistoryData, dataStore);
  await set(entryId, meta, metaStore);
  await trim();
  return entryId;
}

export async function listScans(): Promise<HistoryMeta[]> {
  const ks = await keys(metaStore);
  const metas = ((await getMany(ks, metaStore)) as (HistoryMeta | undefined)[]).filter((m): m is HistoryMeta => !!m);
  return metas.sort((a, b) => b.at - a.at);
}

export async function loadScan(id: string): Promise<SavedShot[] | null> {
  const data = (await get(id, dataStore)) as HistoryData | undefined;
  if (!data) return null;
  const photos = data.photos ?? (data.photo ? [data.photo] : []);
  const shots = data.shots ?? (data.facings ? [data.facings] : []);
  const out: SavedShot[] = [];
  for (let i = 0; i < photos.length; i++) {
    const bmp = await createImageBitmap(photos[i]);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    out.push({ image: c, facings: shots[i] ?? [] });
  }
  return out;
}

export async function deleteScan(id: string) {
  await del(id, metaStore);
  await del(id, dataStore);
}

export async function clearScans() {
  for (const k of await keys(metaStore)) await deleteScan(String(k));
}

async function trim() {
  const all = await listScans();
  for (const m of all.slice(MAX_ENTRIES)) await deleteScan(m.id);
}

const CSV_HEADER = ['scan_id', 'date', 'time', 'store', 'bay', 'photos', 'product', 'category', 'sales_rank', 'result', 'facings', 'top_sellers_found', 'top_sellers_expected'];

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * All saved scans on this phone as a CSV: one row per product per scan
 * (top sellers on shelf / missing / to check, slow sellers and other
 * products seen), plus the bay-level score on every row so it pivots easily.
 */
export async function scansToCsv(): Promise<{ csv: string; scans: number; rows: number }> {
  const metas = (await listScans()).slice().reverse(); // oldest first
  const lines = [CSV_HEADER.join(',')];
  let n = 0;
  for (const m of metas) {
    const d = new Date(m.at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const base = [m.id, date, time, m.store ?? '', m.bay, m.photos ?? 1];
    const tail = [m.present, m.total];
    const rows = m.rows?.length ? m.rows : [{ product: '', result: 'other', facings: m.facings } as ScanRow];
    for (const r of rows) {
      lines.push([...base, r.product, r.category ?? '', r.rank ?? '', r.result, r.facings, ...tail].map(csvCell).join(','));
      n++;
    }
  }
  return { csv: lines.join('\n') + '\n', scans: metas.length, rows: n };
}
