import type { Det, RGBAImage } from './types';

/** Decode a photo (respecting EXIF rotation) into a canvas no larger than maxSide. */
export async function loadImageToCanvas(blob: Blob, maxSide = 3000): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function scaledImageData(src: HTMLCanvasElement, width: number): RGBAImage & { scale: number } {
  const scale = Math.min(1, width / src.width);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height, scale };
}

export function cropCanvas(src: HTMLCanvasElement, d: Det, pad = 0): HTMLCanvasElement {
  const w = d.x2 - d.x1, h = d.y2 - d.y1;
  const x1 = Math.max(0, Math.floor(d.x1 - w * pad));
  const y1 = Math.max(0, Math.floor(d.y1 - h * pad));
  const x2 = Math.min(src.width, Math.ceil(d.x2 + w * pad));
  const y2 = Math.min(src.height, Math.ceil(d.y2 + h * pad));
  const c = document.createElement('canvas');
  c.width = Math.max(1, x2 - x1);
  c.height = Math.max(1, y2 - y1);
  c.getContext('2d')!.drawImage(src, x1, y1, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

export interface QualityReport {
  ok: boolean;
  sharpness: number;
  brightness: number;
  warnings: string[];
}

/** Cheap pre-flight check so reps retake bad photos before wasting time on analysis. */
export function checkQuality(src: HTMLCanvasElement): QualityReport {
  const img = scaledImageData(src, 640);
  const { width: W, height: H, data } = img;
  const g = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    sum += g[i];
  }
  const brightness = sum / (W * H);
  // Variance of the Laplacian – a standard focus measure.
  let m = 0, m2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = g[i - W] + g[i + W] + g[i - 1] + g[i + 1] - 4 * g[i];
      m += l;
      m2 += l * l;
      n++;
    }
  }
  m /= n;
  const sharpness = m2 / n - m * m;
  const warnings: string[] = [];
  if (sharpness < 60) warnings.push('The photo looks blurry. Hold steady and tap to focus before taking it.');
  if (brightness < 55) warnings.push('The photo is quite dark. Move closer or turn off any filters.');
  if (brightness > 225) warnings.push('The photo is over-exposed. Avoid glare from lights and glass doors.');
  if (Math.min(src.width, src.height) < 700) warnings.push('The image resolution is low. Use the camera rather than a screenshot if you can.');
  return { ok: warnings.length === 0, sharpness, brightness, warnings };
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));
}
