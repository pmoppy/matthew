import { getSession, ort } from '../ort';
import type { Det } from '../types';
import { nms } from './nms';

/**
 * Decode a YOLO ONNX output into boxes (in model-input pixel coordinates).
 * Supports the common export layouts:
 *  - Ultralytics YOLOv8/11 raw head: [1, 4 + nc, N] (or transposed [1, N, 4 + nc]), boxes as cx,cy,w,h
 *  - NMS-free / end-to-end exports: [1, N, 6] as x1,y1,x2,y2,score,class
 */
export function decodeYolo(data: Float32Array, dims: readonly number[], conf: number): Det[] {
  const out: Det[] = [];
  if (dims.length !== 3) throw new Error(`Unexpected detector output shape [${dims.join(',')}]`);
  const [, a, b] = dims;
  if (b === 6 && a > 6) {
    for (let i = 0; i < a; i++) {
      const o = i * 6;
      const s = data[o + 4];
      if (s >= conf) out.push({ x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], score: s, kind: 'product' });
    }
    return out;
  }
  // Channel-first if the channel axis is the smaller one.
  const channelFirst = a < b;
  const C = channelFirst ? a : b;
  const N = channelFirst ? b : a;
  const at = channelFirst ? (c: number, i: number) => data[c * N + i] : (c: number, i: number) => data[i * C + c];
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let c = 4; c < C; c++) s = Math.max(s, at(c, i));
    if (C === 4) s = 1;
    if (s < conf) continue;
    const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
    out.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: s, kind: 'product' });
  }
  return out;
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlapping square tiles covering a (scaled) image, SAHI-style. */
export function makeTiles(W: number, H: number, size: number, overlap = 0.2): Tile[] {
  const step = Math.max(1, Math.floor(size * (1 - overlap)));
  const xs = positions(W, size, step);
  const ys = positions(H, size, step);
  const tiles: Tile[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y, w: Math.min(size, W - x), h: Math.min(size, H - y) });
  return tiles;
}

function positions(len: number, size: number, step: number): number[] {
  if (len <= size) return [0];
  const p: number[] = [];
  for (let v = 0; v + size < len; v += step) p.push(v);
  p.push(len - size);
  return p;
}

/**
 * Run a YOLO detector over the image. Dense shelves contain 100+ small packs,
 * so we scale the image so its short side matches the model input and slide
 * overlapping tiles along the long side rather than squashing the whole photo
 * into one 640px square (which loses the small packs).
 */
export async function detectYolo(
  src: HTMLCanvasElement,
  url: string,
  inputSize: number,
  conf: number,
  onProgress?: (msg: string, frac: number) => void,
): Promise<Det[]> {
  const session = await getSession(url, (f) => onProgress?.('Downloading detector model', f));
  const W = src.width, H = src.height;
  const scale = Math.min(1.5, inputSize / Math.min(W, H));
  const sw = Math.round(W * scale), sh = Math.round(H * scale);
  const scaled = document.createElement('canvas');
  scaled.width = sw;
  scaled.height = sh;
  const sctx = scaled.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, sw, sh);

  const tiles = makeTiles(sw, sh, inputSize);
  const tile = document.createElement('canvas');
  tile.width = inputSize;
  tile.height = inputSize;
  const tctx = tile.getContext('2d', { willReadFrequently: true })!;
  const all: Det[] = [];
  const inputName = session.inputNames[0];
  const plane = inputSize * inputSize;

  for (let t = 0; t < tiles.length; t++) {
    onProgress?.(`Finding products (${t + 1}/${tiles.length})`, t / tiles.length);
    const { x, y, w, h } = tiles[t];
    tctx.fillStyle = 'rgb(114,114,114)';
    tctx.fillRect(0, 0, inputSize, inputSize);
    tctx.drawImage(scaled, x, y, w, h, 0, 0, w, h);
    const px = tctx.getImageData(0, 0, inputSize, inputSize).data;
    const input = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      input[i] = px[p] / 255;
      input[i + plane] = px[p + 1] / 255;
      input[i + 2 * plane] = px[p + 2] / 255;
    }
    const feeds = { [inputName]: new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]) };
    const res = await session.run(feeds);
    const outT = res[session.outputNames[0]];
    const dets = decodeYolo(outT.data as Float32Array, outT.dims, conf);
    for (const d of dets) {
      // Drop boxes that are mostly in the padded area.
      if (d.x1 > w || d.y1 > h) continue;
      all.push({
        ...d,
        x1: (Math.max(0, d.x1) + x) / scale,
        y1: (Math.max(0, d.y1) + y) / scale,
        x2: (Math.min(w, d.x2) + x) / scale,
        y2: (Math.min(h, d.y2) + y) / scale,
      });
    }
    // Let the UI breathe between tiles.
    await new Promise((r) => setTimeout(r, 0));
  }
  return nms(all, 0.5, 0.75);
}
