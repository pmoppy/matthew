import type { Det, RGBAImage } from '../types';

/**
 * Built-in fallback detector used when no trained ONNX model is configured.
 *
 * It exploits the structure of a shelf photo rather than "knowing" products:
 *  1. Product rows are horizontal bands with lots of colour and vertical edges;
 *     shelf edges / price strips are greyer with fewer of both.
 *  2. Within a row, neighbouring packs are separated by vertical edges that run
 *     most of the row height. We estimate the typical pack width from the
 *     row's periodicity and pick the best set of cut points with dynamic
 *     programming.
 *
 * It works on neat front-facing shelves of similar-sized packs and degrades on
 * mixed sizes, angled shots and bottles. A trained YOLO detector replaces it.
 */
export function detectShelfGrid(img: RGBAImage): Det[] {
  const { width: W, height: H, data } = img;
  const gray = new Float32Array(W * H);
  const sat = new Float32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  // Vertical-edge map (horizontal gradient).
  const EDGE = 28;
  const vEdge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 1; x < W - 1; x++) {
      vEdge[o + x] = Math.abs(gray[o + x + 1] - gray[o + x - 1]) > EDGE ? 1 : 0;
    }
  }

  // ---- 1. find product bands ------------------------------------------------
  const rowEdge = new Float32Array(H);
  const rowSat = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let e = 0, s = 0;
    const o = y * W;
    for (let x = 0; x < W; x++) {
      e += vEdge[o + x];
      s += sat[o + x];
    }
    rowEdge[y] = e / W;
    rowSat[y] = s / W;
  }
  const eN = percentile(rowEdge, 0.9) || 1;
  const sN = percentile(rowSat, 0.9) || 1;
  let rowScore: Float32Array = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    rowScore[y] = 0.5 * Math.min(1, rowEdge[y] / eN) + 0.5 * Math.min(1, rowSat[y] / sN);
  }
  rowScore = smooth(rowScore, Math.max(1, Math.round(H * 0.004)));

  const minBand = H * 0.025;
  let bands = runs(rowScore, 0.5).filter(([a, b]) => b - a >= minBand * 0.5);
  bands = mergeRuns(bands, H * 0.006).filter(([a, b]) => b - a >= minBand);

  // ---- 2. split each band into facings -------------------------------------
  const out: Det[] = [];
  for (const [y0, y1] of bands) {
    const h = y1 - y0;
    const col = new Float32Array(W);
    const colSat = new Float32Array(W);
    const colGray = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let e = 0, s = 0, gsum = 0;
      for (let y = y0; y < y1; y++) {
        e += vEdge[y * W + x];
        s += sat[y * W + x];
        gsum += gray[y * W + x];
      }
      col[x] = e / h;
      colSat[x] = s / h;
      colGray[x] = gsum / h;
    }
    // Colour change between neighbouring columns is a second boundary cue.
    const colDiff = new Float32Array(W);
    const d = 3;
    for (let x = d; x < W - d; x++) {
      colDiff[x] = Math.abs(colGray[x + d] - colGray[x - d]) / 255 + Math.abs(colSat[x + d] - colSat[x - d]) / 255;
    }
    const cue = smooth(addArrays(col, colDiff, 0.6), 1);

    // Horizontal extent: trim low-content columns at the sides (fixture walls etc.).
    let xs = 0, xe = W - 1;
    const colContent = smooth(colSat, 4);
    const satCut = percentile(colContent, 0.5) * 0.3;
    while (xs < xe && colContent[xs] < satCut) xs++;
    while (xe > xs && colContent[xe] < satCut) xe--;
    if (xe - xs < h * 0.3) continue;

    const w0 = estimatePeriod(cue, xs, xe, Math.round(h * 0.25), Math.round(h * 0.9)) ?? Math.round(h * 0.42);
    const cuts = bestCuts(cue, xs, xe, w0);
    for (let i = 0; i < cuts.length - 1; i++) {
      const xa = cuts[i], xb = cuts[i + 1];
      // Skip slivers left at the row ends.
      if (xb - xa < w0 * 0.35) continue;
      // Texture inside the segment distinguishes products from empty shelf.
      let m = 0, m2 = 0, n = 0, sMean = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = xa; x < xb; x += 2) {
          const v = gray[y * W + x];
          m += v; m2 += v * v; sMean += sat[y * W + x]; n++;
        }
      }
      m /= n; sMean /= n;
      const std = Math.sqrt(Math.max(0, m2 / n - m * m));
      const isGap = std < 18 && sMean < 25;
      out.push({ x1: xa, y1: y0, x2: xb, y2: y1, score: isGap ? 0.3 : 0.5, kind: isGap ? 'gap' : 'product' });
    }
  }
  return out;
}

function percentile(a: Float32Array, q: number): number {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

function smooth(a: Float32Array, r: number): Float32Array {
  const out = new Float32Array(a.length);
  let acc = 0;
  const pre = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - r), hi = Math.min(a.length, i + r + 1);
    acc = (pre[hi] - pre[lo]) / (hi - lo);
    out[i] = acc;
  }
  return out;
}

function addArrays(a: Float32Array, b: Float32Array, wb: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + wb * b[i];
  return out;
}

function runs(a: Float32Array, thr: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= a.length; i++) {
    const on = i < a.length && a[i] > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

function mergeRuns(r: [number, number][], gap: number): [number, number][] {
  const out: [number, number][] = [];
  for (const cur of r) {
    const last = out[out.length - 1];
    if (last && cur[0] - last[1] <= gap) last[1] = cur[1];
    else out.push([cur[0], cur[1]]);
  }
  return out;
}

/** Dominant spacing of boundary cues via autocorrelation. */
function estimatePeriod(cue: Float32Array, xs: number, xe: number, minLag: number, maxLag: number): number | null {
  const n = xe - xs;
  if (n < minLag * 2) return null;
  let mean = 0;
  for (let x = xs; x < xe; x++) mean += cue[x];
  mean /= n;
  const ac = (lag: number) => {
    let s = 0;
    for (let x = xs; x + lag < xe; x++) s += (cue[x] - mean) * (cue[x + lag] - mean);
    return s / (n - lag);
  };
  const lo = Math.max(4, minLag);
  const top = Math.min(maxLag, Math.floor(n / 2));
  if (top < lo) return null;
  const acs: number[] = [];
  for (let lag = lo; lag <= top; lag++) acs.push(ac(lag));
  const best = Math.max(...acs);
  if (!(best > 0)) return null;
  // A perfectly regular shelf also correlates at 2x, 3x the pack width, so
  // take the first strong local maximum rather than the global one.
  for (let i = 0; i < acs.length; i++) {
    const isPeak = (i === 0 || acs[i] >= acs[i - 1]) && (i === acs.length - 1 || acs[i] >= acs[i + 1]);
    if (isPeak && acs[i] >= 0.85 * best) return lo + i;
  }
  return lo + acs.indexOf(best);
}

/** Choose cut points maximising boundary cue while keeping widths near w0. */
function bestCuts(cue: Float32Array, xs: number, xe: number, w0: number): number[] {
  const minW = Math.max(3, Math.round(w0 * 0.6));
  const maxW = Math.round(w0 * 1.5);
  const n = xe - xs;
  // Score cuts relative to the row's typical cue so extra cuts are not free.
  const slice = Float32Array.from(cue.subarray(xs, xe));
  const base = percentile(slice, 0.6);
  const spread = Math.max(1e-3, percentile(slice, 0.95) - base);
  const score = new Float64Array(n + 1).fill(-Infinity);
  const prev = new Int32Array(n + 1).fill(-1);
  score[0] = 0;
  for (let i = 1; i <= n; i++) {
    const c = i === n ? 0 : (cue[xs + i] - base) / spread;
    for (let w = minW; w <= maxW && w <= i; w++) {
      const j = i - w;
      if (score[j] === -Infinity) continue;
      const dev = (w - w0) / w0;
      const s = score[j] + c - 2.5 * dev * dev;
      if (s > score[i]) {
        score[i] = s;
        prev[i] = j;
      }
    }
    // Allow a short partial pack at either end of the row.
    if (i < minW && score[i] === -Infinity) {
      score[i] = c - 0.3;
      prev[i] = 0;
    }
  }
  // End may also be a partial pack.
  let end = n;
  for (let i = Math.max(0, n - minW); i < n; i++) if (score[i] - 0.3 > score[end]) end = i;
  const cuts: number[] = [];
  let i = end;
  if (end !== n) cuts.push(xe);
  while (i > 0 && prev[i] >= 0) {
    cuts.push(xs + i);
    i = prev[i];
  }
  cuts.push(xs);
  return cuts.reverse();
}
