import { matchCrop, type CatalogState } from './catalog';
import { detectShelfGrid } from './detect/heuristic';
import { detectYolo } from './detect/yolo';
import { colorHist, cosine, embedCrops, histSimilarity } from './embed';
import { cropCanvas, scaledImageData } from './image';
import { statusFor } from './recommend';
import type { SalesInfo } from './sales';
import { getEmbedder, type Det, type Facing, type Settings } from './types';

export interface AnalysisResult {
  facings: Facing[];
  /** Per-facing crop features, kept in memory so corrections can teach the catalogue. */
  features: Map<number, { emb?: Float32Array; hist: Float32Array }>;
  detector: 'model' | 'grid';
  timings: { detect: number; recognise: number };
  warnings: string[];
}

export type Progress = (msg: string, frac: number) => void;

export async function analyseShelf(
  img: HTMLCanvasElement,
  catalog: CatalogState | null,
  sales: Map<string, SalesInfo> | null,
  settings: Settings,
  onProgress: Progress,
): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const t0 = performance.now();
  let dets: Det[];
  let detector: AnalysisResult['detector'] = 'grid';
  if (settings.detectorUrl) {
    try {
      dets = await detectYolo(img, settings.detectorUrl, settings.detectorInputSize, settings.detectorConfidence, onProgress);
      detector = 'model';
    } catch (e) {
      console.error(e);
      warnings.push(`Detector model failed (${(e as Error).message}). Used the basic shelf-grid detector instead.`);
      dets = gridDetect(img);
    }
  } else {
    onProgress('Finding products', 0.1);
    dets = gridDetect(img);
  }
  dets = dropEdgeFragments(dets, img.width);
  // Reading order: top shelf first, left to right.
  dets.sort((a, b) => {
    const ra = (a.y1 + a.y2) / 2, rb = (b.y1 + b.y2) / 2;
    const h = Math.min(a.y2 - a.y1, b.y2 - b.y1) / 2;
    return Math.abs(ra - rb) < h ? a.x1 - b.x1 : ra - rb;
  });
  const t1 = performance.now();

  const facings: Facing[] = dets.map((d, id) => ({
    ...d,
    id,
    product: null,
    confidence: 0,
    candidates: [],
    status: d.kind === 'gap' ? 'gap' : 'unknown',
  }));
  const features: AnalysisResult['features'] = new Map();
  const products = facings.filter((f) => f.kind === 'product');
  const crops = products.map((f) => cropCanvas(img, f));
  products.forEach((f, i) => features.set(f.id, { hist: colorHist(crops[i]) }));

  if (catalog && catalog.entries.length && crops.length) {
    try {
      // Trim the crop edges slightly: detector boxes often include a sliver of the
      // neighbouring packs, which confuses recognition on tightly packed shelves.
      const trimmed = products.map((f) => cropCanvas(img, inset(f, 0.06, 0.03)));
      const embs = await embedCrops(trimmed, getEmbedder(catalog.embedderId), onProgress);
      products.forEach((f, i) => (features.get(f.id)!.emb = embs[i]));
      // Shelves are merchandised in blocks: pool the evidence of adjacent,
      // near-identical facings so a run of the same SKU is judged together.
      products.forEach((f, i) => {
        const feat = features.get(f.id)!;
        const group = [i];
        for (let j = 0; j < products.length; j++) {
          if (j !== i && adjacent(f, products[j]) && dot(embs[i], embs[j]) >= 0.88) group.push(j);
        }
        const pooled = new Float32Array(embs[i].length);
        const hist = new Float32Array(feat.hist.length);
        for (const g of group) {
          const e = embs[g], h = features.get(products[g].id)!.hist;
          for (let d = 0; d < pooled.length; d++) pooled[d] += e[d];
          for (let b = 0; b < hist.length; b++) hist[b] += h[b] / group.length;
        }
        const n = Math.hypot(...pooled) || 1;
        for (let d = 0; d < pooled.length; d++) pooled[d] /= n;
        const m = matchCrop(pooled, hist, catalog.entries);
        f.candidates = m;
        f.product = m[0]?.product ?? null;
        f.confidence = m[0]?.score ?? 0;
      });
    } catch (e) {
      console.error(e);
      warnings.push(`Product recognition failed: ${(e as Error).message}`);
    }
  }
  for (const f of facings) f.status = statusFor(f, sales, settings);
  propagateFromNeighbours(facings, features, sales, settings);
  const t2 = performance.now();
  return { facings, features, detector, timings: { detect: t1 - t0, recognise: t2 - t1 }, warnings };
}

function gridDetect(img: HTMLCanvasElement): Det[] {
  const small = scaledImageData(img, 800);
  const inv = 1 / small.scale;
  return detectShelfGrid(small).map((d) => ({ ...d, x1: d.x1 * inv, y1: d.y1 * inv, x2: d.x2 * inv, y2: d.y2 * inv }));
}

/**
 * Packs cut off by the left/right edge of the photo can't be identified
 * reliably, and they are counted properly in the next bay's photo. Drop
 * detections that touch the side edge and are much narrower than their row.
 */
export function dropEdgeFragments(dets: Det[], imageWidth: number): Det[] {
  const margin = imageWidth * 0.012;
  return dets.filter((d) => {
    const atEdge = d.x1 <= margin || d.x2 >= imageWidth - margin;
    if (!atEdge || d.kind !== 'product') return true;
    const h = d.y2 - d.y1;
    const row = dets.filter((o) => o !== d && Math.abs((o.y1 + o.y2) / 2 - (d.y1 + d.y2) / 2) < h * 0.4);
    if (row.length < 3) return true;
    const widths = row.map((o) => o.x2 - o.x1).sort((a, b) => a - b);
    const median = widths[widths.length >> 1];
    return d.x2 - d.x1 >= median * 0.6;
  });
}

/**
 * Shelves are merchandised in blocks of the same SKU. If an unclear facing is
 * almost identical to a confidently identified neighbour in the same row, and
 * that product was already one of its own candidates, adopt the label.
 * Threshold 0.92: on real shelf data identical neighbours scored 0.81-0.97 and
 * different flavours of the same range up to 0.90.
 */
export function propagateFromNeighbours(
  facings: Facing[],
  features: AnalysisResult['features'],
  sales: Map<string, SalesInfo> | null,
  settings: Settings,
) {
  const sim = (a: Facing, b: Facing) => {
    const fa = features.get(a.id), fb = features.get(b.id);
    if (!fa?.emb || !fb?.emb) return 0;
    return 0.85 * cosine(fa.emb, fb.emb) + 0.15 * histSimilarity(fa.hist, fb.hist);
  };
  const neighbours = (f: Facing) => {
    const h = f.y2 - f.y1, w = f.x2 - f.x1;
    return facings.filter(
      (o) =>
        o !== f &&
        o.kind === 'product' &&
        Math.abs((o.y1 + o.y2) / 2 - (f.y1 + f.y2) / 2) < h * 0.35 &&
        Math.min(Math.abs(o.x1 - f.x2), Math.abs(f.x1 - o.x2)) < w * 0.35,
    );
  };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const f of facings) {
      if (f.status !== 'unsure') continue;
      for (const n of neighbours(f)) {
        if (n.status === 'unsure' || n.status === 'unknown' || !n.product) continue;
        if (!f.candidates.slice(0, 3).some((c) => c.product === n.product)) continue;
        if (sim(f, n) < 0.92) continue;
        f.product = n.product;
        f.viaNeighbour = true;
        f.status = statusFor(f, sales, settings);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
}

function inset(d: Det, fx: number, fy: number): Det {
  const w = d.x2 - d.x1, h = d.y2 - d.y1;
  return { ...d, x1: d.x1 + w * fx, x2: d.x2 - w * fx, y1: d.y1 + h * fy, y2: d.y2 - h * fy };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Same shelf row and within two pack-widths of each other. */
function adjacent(a: Det, b: Det): boolean {
  const h = Math.min(a.y2 - a.y1, b.y2 - b.y1);
  const w = Math.max(a.x2 - a.x1, b.x2 - b.x1);
  const sameRow = Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2) < h * 0.35;
  const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
  return sameRow && gap < w * 2;
}
