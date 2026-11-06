import { getSession, ort, runModel } from './ort';
import type { EmbedderSpec } from './types';

const SIZE = 224;

const work = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** Letterbox a crop into a square (packs are tall; centre-cropping would cut the brand off). */
function toTensorData(c: HTMLCanvasElement, out: Float32Array, offset: number, MEAN: number[], STD: number[]) {
  const w = work!;
  w.width = SIZE;
  w.height = SIZE;
  const ctx = w.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'rgb(124,116,104)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / Math.max(c.width, c.height);
  const dw = Math.round(c.width * s), dh = Math.round(c.height * s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, c.width, c.height, (SIZE - dw) >> 1, (SIZE - dh) >> 1, dw, dh);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[offset + i] = (px[p] / 255 - MEAN[0]) / STD[0];
    out[offset + plane + i] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
    out[offset + 2 * plane + i] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
  }
}

function l2(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

let batchOk = true;

/** Embed image crops into L2-normalised vectors using the configured ONNX vision model. */
export async function embedCrops(
  crops: HTMLCanvasElement[],
  spec: EmbedderSpec,
  onProgress?: (msg: string, frac: number) => void,
): Promise<Float32Array[]> {
  const session = await getSession(spec.url, (f) => onProgress?.('Downloading recognition model', f), spec.dataUrl);
  const inputName = session.inputNames.includes('pixel_values') ? 'pixel_values' : session.inputNames[0];
  const outName =
    ['image_embeds', 'pooler_output'].find((n) => session.outputNames.includes(n)) ?? session.outputNames[0];
  const plane = 3 * SIZE * SIZE;
  const results: Float32Array[] = [];
  const B = 8;
  for (let i = 0; i < crops.length; ) {
    const n = batchOk ? Math.min(B, crops.length - i) : 1;
    const data = new Float32Array(n * plane);
    for (let k = 0; k < n; k++) toTensorData(crops[i + k], data, k * plane, spec.mean, spec.std);
    let res: ort.InferenceSession.OnnxValueMapType;
    try {
      res = await runModel(spec.url, { [inputName]: new ort.Tensor('float32', data, [n, 3, SIZE, SIZE]) }, spec.dataUrl);
    } catch (e) {
      if (batchOk && n > 1) {
        batchOk = false; // model exported with a fixed batch of 1
        continue;
      }
      throw e;
    }
    const t = res[outName];
    const d = t.data as Float32Array;
    if (t.dims.length === 2) {
      const dim = t.dims[1];
      for (let k = 0; k < n; k++) results.push(l2(d.slice(k * dim, (k + 1) * dim)));
    } else if (t.dims.length === 3) {
      // [batch, tokens, dim] – use the CLS token.
      const tokens = t.dims[1], dim = t.dims[2];
      for (let k = 0; k < n; k++) results.push(l2(d.slice(k * tokens * dim, k * tokens * dim + dim)));
    } else {
      throw new Error(`Unexpected embedding output shape [${t.dims.join(',')}]`);
    }
    i += n;
    onProgress?.('Recognising products', i / crops.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}

export const HIST_BINS = 12 * 3 + 4;

/**
 * Hue/saturation colour histogram of the central part of a crop. Many SKUs
 * differ only by colour (e.g. flavour variants of the same brand), where
 * general-purpose embeddings are weakest, so this is blended into the score.
 */
export function colorHist(c: HTMLCanvasElement): Float32Array {
  // Sample the original pixels of the central region (no resizing), so the
  // result is the same whether computed here or by scripts/build_index.py.
  const x0 = Math.floor(c.width * 0.15), y0 = Math.floor(c.height * 0.1);
  const w = Math.max(1, Math.floor(c.width * 0.7)), h = Math.max(1, Math.floor(c.height * 0.8));
  const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
  const hist = new Float32Array(HIST_BINS);
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      const r = px[p] / 255, g = px[p + 1] / 255, b = px[p + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const d = mx - mn;
      const sat = mx ? d / mx : 0;
      n++;
      if (sat < 0.2 || mx < 0.12) {
        hist[36 + Math.min(3, Math.floor(mx * 4))]++; // achromatic: bin by brightness
        continue;
      }
      let hue = 0;
      if (mx === r) hue = ((g - b) / d + 6) % 6;
      else if (mx === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      const hb = Math.min(11, Math.floor((hue / 6) * 12));
      const sb = sat < 0.45 ? 0 : sat < 0.75 ? 1 : 2;
      hist[hb * 3 + sb]++;
    }
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= n || 1;
  return hist;
}

export function histSimilarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
