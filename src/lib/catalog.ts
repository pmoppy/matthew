import { createStore, get, set, del, keys, getMany } from 'idb-keyval';
import { colorHist, cosine, embedCrops, histSimilarity } from './embed';
import { canvasToBlob, loadImageToCanvas } from './image';
import { getEmbedder } from './types';

const embStore = createStore('shelfscan-embeddings', 'v1');
const appStore = createStore('shelfscan-app', 'v1');
const corrStore = createStore('shelfscan-corrections', 'v1');

export interface RefImage {
  product: string;
  key: string;
  load: () => Promise<Blob>;
}

export interface CatalogEntry {
  product: string;
  key: string;
  emb: Float32Array;
  hist: Float32Array;
  source: 'catalog' | 'correction';
}

export interface CatalogState {
  products: string[];
  entries: CatalogEntry[];
  embedderId: string;
  source: string;
  updatedAt: number;
}

export interface WorkerManifest {
  products: { name: string; images: string[] }[];
  sales?: string | null;
  detector?: string | null;
}

const IMG_EXT = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;

function trimBase(base: string) {
  return base.replace(/\/+$/, '');
}

export function fileUrl(base: string, path: string) {
  return `${trimBase(base)}/file/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Make a manifest-relative URL absolute (works for "/starter" and full Worker URLs). */
function absolute(u: string) {
  return new URL(u, location.href).toString();
}

/** Read the product list from the catalogue Worker (folders of images in R2). */
export async function listFromWorker(base: string): Promise<{ refs: RefImage[]; salesUrl?: string; detectorUrl?: string }> {
  const res = await fetch(absolute(`${trimBase(base)}/manifest.json`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Catalogue server returned ${res.status}. Check the URL.`);
  const m = (await res.json()) as WorkerManifest;
  const refs: RefImage[] = [];
  for (const p of m.products) {
    for (const img of p.images) {
      const url = absolute(fileUrl(base, img));
      refs.push({
        product: p.name,
        key: url,
        load: async () => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Image ${img} returned ${r.status}`);
          return r.blob();
        },
      });
    }
  }
  return {
    refs,
    salesUrl: m.sales ? absolute(fileUrl(base, m.sales)) : undefined,
    detectorUrl: m.detector ? absolute(fileUrl(base, m.detector)) : undefined,
  };
}

/**
 * Read a local folder picked with <input webkitdirectory>. Expected layout
 * matches the bucket: <root>/<Product name>/<image>.jpg, optionally a
 * sales.csv at the root.
 */
export function listFromFiles(files: FileList | File[]): { refs: RefImage[]; salesFile?: File } {
  const refs: RefImage[] = [];
  let salesFile: File | undefined;
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/').filter(Boolean);
    if (/\.csv$/i.test(f.name) && /sales/i.test(f.name)) salesFile = f;
    if (!IMG_EXT.test(f.name) || parts.length < 2) continue;
    const product = parts[parts.length - 2];
    if (product.startsWith('_') || product.startsWith('.')) continue;
    refs.push({ product, key: `local:${rel}:${f.size}:${f.lastModified}`, load: async () => f });
  }
  return { refs, salesFile };
}

/** Embed all reference images (cached per image + model, so re-syncs are fast). */
export async function buildCatalog(
  refs: RefImage[],
  embedderId: string,
  source: string,
  onProgress: (msg: string, frac: number) => void,
): Promise<CatalogState> {
  const entries: CatalogEntry[] = [];
  const cacheKeys = refs.map((r) => `${embedderId}::${r.key}`);
  const cached = (await getMany(cacheKeys, embStore)) as ({ emb: Float32Array; hist: Float32Array } | undefined)[];
  const todo: number[] = [];
  refs.forEach((r, i) => {
    const c = cached[i];
    if (c) entries.push({ product: r.product, key: r.key, emb: c.emb, hist: c.hist, source: 'catalog' });
    else todo.push(i);
  });
  const failures: string[] = [];
  const CHUNK = 16;
  for (let s = 0; s < todo.length; s += CHUNK) {
    const idx = todo.slice(s, s + CHUNK);
    const loaded = await Promise.all(
      idx.map(async (i) => {
        try {
          return { i, canvas: await loadImageToCanvas(await refs[i].load(), 512) };
        } catch (e) {
          failures.push(`${refs[i].product}: ${(e as Error).message}`);
          return null;
        }
      }),
    );
    const good = loaded.filter((x): x is { i: number; canvas: HTMLCanvasElement } => !!x);
    const ok = good.map((g) => g.i);
    const canvases = good.map((g) => g.canvas);
    const embs = await embedCrops(canvases, getEmbedder(embedderId), (msg, f) => {
      if (msg.startsWith('Downloading')) onProgress(msg, f);
    });
    for (let k = 0; k < ok.length; k++) {
      const r = refs[ok[k]];
      const hist = colorHist(canvases[k]);
      entries.push({ product: r.product, key: r.key, emb: embs[k], hist, source: 'catalog' });
      await set(cacheKeys[ok[k]], { emb: embs[k], hist }, embStore);
    }
    onProgress(`Learning product images (${Math.min(todo.length, s + CHUNK)}/${todo.length})`, (s + CHUNK) / todo.length);
  }
  if (failures.length) console.warn('Some reference images failed to load', failures);
  // Keep any corrections made in-store.
  const corrections = await loadCorrectionEntries(embedderId);
  const all = [...entries, ...corrections];
  const state: CatalogState = {
    products: [...new Set(refs.map((r) => r.product))].sort((a, b) => a.localeCompare(b)),
    entries: all,
    embedderId,
    source,
    updatedAt: Date.now(),
  };
  await saveCatalog(state);
  return state;
}

export async function saveCatalog(c: CatalogState) {
  await set('catalog', c, appStore);
}
export async function loadCatalog(): Promise<CatalogState | null> {
  return ((await get('catalog', appStore)) as CatalogState | undefined) ?? null;
}
export async function clearCatalog() {
  await del('catalog', appStore);
}

export interface StoredSales {
  text: string;
  /** "library" = published with the catalogue; "manual" = uploaded by the admin on this device. */
  source: 'library' | 'manual';
}

export async function saveSales(v: StoredSales | null) {
  if (v === null) await del('sales', appStore);
  else await set('sales', v, appStore);
}
export async function loadSales(): Promise<StoredSales | null> {
  return ((await get('sales', appStore)) as StoredSales | undefined) ?? null;
}

export interface Match {
  product: string;
  score: number;
}

/**
 * Nearest-neighbour search over reference images. Each product's score is its
 * best-matching reference image; the final score blends embedding similarity
 * with colour similarity.
 */
export function matchCrop(emb: Float32Array, hist: Float32Array, entries: CatalogEntry[], k = 3): Match[] {
  const best = new Map<string, number>();
  for (const e of entries) {
    if (e.emb.length !== emb.length) continue;
    const s = 0.85 * cosine(emb, e.emb) + 0.15 * histSimilarity(hist, e.hist);
    if (s > (best.get(e.product) ?? -Infinity)) best.set(e.product, s);
  }
  return [...best.entries()]
    .map(([product, score]) => ({ product, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---- corrections: in-store feedback that becomes new training/reference data

interface StoredCorrection {
  product: string;
  blob: Blob;
  emb: Float32Array;
  hist: Float32Array;
  embedderId: string;
  at: number;
}

export async function addCorrection(
  product: string,
  crop: HTMLCanvasElement,
  emb: Float32Array | undefined,
  hist: Float32Array,
  embedderId: string,
): Promise<CatalogEntry | null> {
  const blob = await canvasToBlob(crop, 'image/jpeg', 0.92);
  const at = Date.now();
  const key = `correction:${at}:${Math.random().toString(36).slice(2, 8)}`;
  await set(key, { product, blob, emb, hist, embedderId, at } satisfies Partial<StoredCorrection>, corrStore);
  return emb ? { product, key, emb, hist, source: 'correction' } : null;
}

async function loadCorrectionEntries(embedderId: string): Promise<CatalogEntry[]> {
  const ks = await keys(corrStore);
  const vals = (await getMany(ks, corrStore)) as StoredCorrection[];
  return vals
    .map((v, i) => ({ v, k: String(ks[i]) }))
    .filter(({ v }) => v && v.emb && v.embedderId === embedderId)
    .map(({ v, k }) => ({ product: v.product, key: k, emb: v.emb, hist: v.hist, source: 'correction' as const }));
}

export async function countCorrections(): Promise<number> {
  return (await keys(corrStore)).length;
}

/** Zip of corrected crops in the same <Product>/<image>.jpg layout as the bucket. */
export async function exportCorrectionsZip(): Promise<Blob | null> {
  const { zipSync } = await import('fflate');
  const ks = await keys(corrStore);
  if (!ks.length) return null;
  const vals = (await getMany(ks, corrStore)) as StoredCorrection[];
  const files: Record<string, Uint8Array> = {};
  for (const v of vals) {
    if (!v) continue;
    const safe = v.product.replace(/[\\/:*?"<>|]/g, '_');
    files[`${safe}/shelf-${v.at}.jpg`] = new Uint8Array(await v.blob.arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export async function clearCorrections() {
  for (const k of await keys(corrStore)) await del(k, corrStore);
}

export async function clearEmbeddingCache() {
  for (const k of await keys(embStore)) await del(k, embStore);
}
