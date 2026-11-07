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
  /** Small JPEG for the list. */
  thumb: Blob;
}

interface HistoryData {
  photo: Blob;
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

export async function saveScan(
  image: HTMLCanvasElement,
  facings: Facing[],
  info: Pick<HistoryMeta, 'bay' | 'present' | 'total' | 'missing'>,
  id?: string,
): Promise<string> {
  const { canvas, scale } = scaleCanvas(image, PHOTO_MAX_SIDE);
  const scaled = facings.map((f) => ({ ...f, x1: f.x1 * scale, y1: f.y1 * scale, x2: f.x2 * scale, y2: f.y2 * scale }));
  const entryId = id ?? `${Date.now()}`;
  const existing = id ? ((await get(id, metaStore)) as HistoryMeta | undefined) : undefined;
  const [photo, thumb] = await Promise.all([
    canvasToBlob(canvas, 'image/jpeg', 0.82),
    canvasToBlob(scaleCanvas(image, 240).canvas, 'image/jpeg', 0.7),
  ]);
  const meta: HistoryMeta = {
    id: entryId,
    at: existing?.at ?? Date.now(),
    facings: facings.filter((f) => f.kind === 'product').length,
    thumb,
    ...info,
  };
  await set(entryId, { photo, facings: scaled } satisfies HistoryData, dataStore);
  await set(entryId, meta, metaStore);
  await trim();
  return entryId;
}

/** Update the labels of a saved scan after the rep confirms or corrects boxes. */
export async function updateScanFacings(
  id: string,
  image: HTMLCanvasElement,
  facings: Facing[],
  info: Pick<HistoryMeta, 'bay' | 'present' | 'total' | 'missing'>,
) {
  const data = (await get(id, dataStore)) as HistoryData | undefined;
  const meta = (await get(id, metaStore)) as HistoryMeta | undefined;
  if (!data || !meta) return;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.width, image.height));
  // The image on screen may be the full photo (fresh scan) or the stored one (reopened).
  const factor = image.width <= PHOTO_MAX_SIDE && image.height <= PHOTO_MAX_SIDE ? 1 : scale;
  data.facings = facings.map((f) => ({ ...f, x1: f.x1 * factor, y1: f.y1 * factor, x2: f.x2 * factor, y2: f.y2 * factor }));
  await set(id, data, dataStore);
  await set(id, { ...meta, ...info }, metaStore);
}

export async function listScans(): Promise<HistoryMeta[]> {
  const ks = await keys(metaStore);
  const metas = ((await getMany(ks, metaStore)) as (HistoryMeta | undefined)[]).filter((m): m is HistoryMeta => !!m);
  return metas.sort((a, b) => b.at - a.at);
}

export async function loadScan(id: string): Promise<{ image: HTMLCanvasElement; facings: Facing[] } | null> {
  const data = (await get(id, dataStore)) as HistoryData | undefined;
  if (!data) return null;
  const bmp = await createImageBitmap(data.photo);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return { image: c, facings: data.facings };
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
