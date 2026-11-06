import type { Det } from '../types';

function area(d: Det) {
  return Math.max(0, d.x2 - d.x1) * Math.max(0, d.y2 - d.y1);
}

function inter(a: Det, b: Det) {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Greedy NMS. Besides IoU we also suppress boxes mostly contained in a
 * stronger box (intersection-over-smaller), which removes the partial
 * duplicates that tiling creates at tile seams.
 */
export function nms(dets: Det[], iouThr = 0.5, iosThr = 0.75): Det[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Det[] = [];
  for (const d of sorted) {
    let ok = true;
    for (const k of keep) {
      const i = inter(d, k);
      if (!i) continue;
      const ad = area(d), ak = area(k);
      if (i / (ad + ak - i) > iouThr || i / Math.min(ad, ak) > iosThr) {
        ok = false;
        break;
      }
    }
    if (ok) keep.push(d);
  }
  return keep;
}
