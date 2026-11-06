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
  /** Path inside the library (as listed in the manifest), used to look up pre-computed fingerprints. */
  path?: string;
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
  /** Manifest version (its "generated" stamp) the library was built from. */
  version?: string;
}

export interface IndexInfo {
  file: string;
  dim: number;
  hist: number;
  /** Library paths of the fingerprinted photos, in file order. */
  images: string[];
}

export interface WorkerManifest {
  generated?: string;
  products: { name: string; images: string[] }[];
  sales?: string | null;
  detector?: string | null;
  /** Pre-computed fingerprints per recognition model (scripts/build_index.py). */
  indexes?: Record<string, IndexInfo>;
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
export interface LibraryListing {
  refs: RefImage[];
  salesUrl?: string;
  detectorUrl?: string;
  version?: string;
  indexes: Record<string, IndexInfo & { url: string }>;
}

export async function listFromWorker(base: string): Promise<LibraryListing> {
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
        path: img,
        load: async () => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Image ${img} returned ${r.status}`);
          return r.blob();
        },
      });
    }
  }
  const indexes: LibraryListing['indexes'] = {};
  for (const [id, info] of Object.entries(m.indexes ?? {})) indexes[id] = { ...info, url: absolute(fileUrl(base, info.file)) };
  return {
    version: m.generated,
    indexes,
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

/** Embed reference images on the device (cached per image + model, so re-syncs are fast). */
async function learnRefs(refs: RefImage[], embedderId: string, onProgress: (msg: string, frac: number) => void): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = [];
  const cacheKeys = refs.map((r) => `${embedderId}::${r.key}`);
  const cached = (await getMany(cacheKeys, embStore)) as ({ emb: Float32Array; hist: Float32Array } | undefined)[];
  const todo: number[] = [];
  refs.forEach((r, i) => {
    const c = cached[i];
    if (c) entries.push({ product: r.product, key: r.key, emb: c.emb, hist: c.hist, source: 'catalog' });
    else todo.push(i);
  });
  const CHUNK = 16;
  for (let s = 0; s < todo.length; s += CHUNK) {
    const idx = todo.slice(s, s + CHUNK);
    const loaded = await Promise.all(
      idx.map(async (i) => {
        try {
          return { i, canvas: await loadImageToCanvas(await refs[i].load(), 512) };
        } catch (e) {
          console.warn(`Reference image failed: ${refs[i].product}`, e);
          return null;
        }
      }),
    );
    const good = loaded.filter((x): x is { i: number; canvas: HTMLCanvasElement } => !!x);
    const embs = await embedCrops(
      good.map((g) => g.canvas),
      getEmbedder(embedderId),
      (msg, f) => {
        if (msg.startsWith('Downloading')) onProgress(msg, f);
      },
    );
    for (let k = 0; k < good.length; k++) {
      const r = refs[good[k].i];
      const hist = colorHist(good[k].canvas);
      entries.push({ product: r.product, key: r.key, emb: embs[k], hist, source: 'catalog' });
      await set(cacheKeys[good[k].i], { emb: embs[k], hist }, embStore);
    }
    onProgress(`Learning product images (${Math.min(todo.length, s + CHUNK)}/${todo.length})`, (s + CHUNK) / todo.length);
  }
  return entries;
}

async function finishCatalog(refs: RefImage[], entries: CatalogEntry[], embedderId: string, source: string): Promise<CatalogState> {
  const corrections = await loadCorrectionEntries(embedderId);
  const state: CatalogState = {
    products: [...new Set(refs.map((r) => r.product))].sort((a, b) => a.localeCompare(b)),
    entries: [...entries, ...corrections],
    embedderId,
    source,
    updatedAt: Date.now(),
  };
  await saveCatalog(state);
  return state;
}

/** Learn every reference photo on the device (no pre-computed index available). */
export async function buildCatalog(
  refs: RefImage[],
  embedderId: string,
  source: string,
  onProgress: (msg: string, frac: number) => void,
): Promise<CatalogState> {
  return finishCatalog(refs, await learnRefs(refs, embedderId, onProgress), embedderId, source);
}

/**
 * Build the catalogue from pre-computed fingerprints (scripts/build_index.py):
 * one small download instead of fetching and processing every photo on the
 * phone. Photos added since the index was built are learned on the device.
 * Layout per photo: dim x int8 embedding, then hist x uint8 histogram.
 */
export async function catalogFromIndex(
  refs: RefImage[],
  index: IndexInfo & { url: string },
  embedderId: string,
  source: string,
  onProgress: (msg: string, frac: number) => void,
): Promise<CatalogState> {
  onProgress('Downloading product fingerprints', 0.1);
  const res = await fetch(index.url);
  if (!res.ok) throw new Error(`Fingerprint index returned ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const stride = index.dim + index.hist;
  if (buf.length !== stride * index.images.length) throw new Error('Fingerprint index is corrupt');
  const signed = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const row = new Map(index.images.map((p, i) => [p, i]));
  const entries: CatalogEntry[] = [];
  const missing: RefImage[] = [];
  for (const r of refs) {
    const i = r.path !== undefined ? row.get(r.path) : undefined;
    if (i === undefined) {
      missing.push(r);
      continue;
    }
    const o = i * stride;
    const emb = new Float32Array(index.dim);
    let n = 0;
    for (let d = 0; d < index.dim; d++) {
      emb[d] = signed[o + d] / 127;
      n += emb[d] * emb[d];
    }
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < index.dim; d++) emb[d] /= n;
    const hist = new Float32Array(index.hist);
    for (let h = 0; h < index.hist; h++) hist[h] = buf[o + index.dim + h] / 255;
    entries.push({ product: r.product, key: r.key, emb, hist, source: 'catalog' });
  }
  if (missing.length) entries.push(...(await learnRefs(missing, embedderId, onProgress)));
  onProgress('Product library ready', 1);
  return finishCatalog(refs, entries, embedderId, source);
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
