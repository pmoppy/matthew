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
  info: Pick<HistoryMeta, 'bay' | 'present' | 'total' | 'missing'>,
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
