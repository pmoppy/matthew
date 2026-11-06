import { matchCrop, type CatalogState } from './catalog';
import { detectShelfGrid } from './detect/heuristic';
import { detectYolo } from './detect/yolo';
import { colorHist, embedCrops } from './embed';
import { cropCanvas, scaledImageData } from './image';
import { statusFor } from './recommend';
import type { SalesInfo } from './sales';
import type { Det, Facing, Settings } from './types';

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
      const embs = await embedCrops(crops, catalog.embedderUrl, onProgress);
      products.forEach((f, i) => {
        const feat = features.get(f.id)!;
        feat.emb = embs[i];
        const m = matchCrop(embs[i], feat.hist, catalog.entries);
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
  const t2 = performance.now();
  return { facings, features, detector, timings: { detect: t1 - t0, recognise: t2 - t1 }, warnings };
}

function gridDetect(img: HTMLCanvasElement): Det[] {
  const small = scaledImageData(img, 800);
  const inv = 1 / small.scale;
  return detectShelfGrid(small).map((d) => ({ ...d, x1: d.x1 * inv, y1: d.y1 * inv, x2: d.x2 * inv, y2: d.y2 * inv }));
}
