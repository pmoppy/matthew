import { describe, expect, it } from 'vitest';
import { detectShelfGrid } from '../detect/heuristic';
import { nms } from '../detect/nms';
import { decodeYolo, makeTiles } from '../detect/yolo';
import { recommend, statusFor, summarise } from '../recommend';
import { classifySales, normName, parseCsv, parseSales } from '../sales';
import type { Det, Facing } from '../types';

const det = (x1: number, y1: number, x2: number, y2: number, score = 0.9): Det => ({ x1, y1, x2, y2, score, kind: 'product' });

describe('decodeYolo', () => {
  it('decodes channel-first ultralytics output [1, 4+nc, N]', () => {
    // 8 anchors, one class: only anchor0 is confident
    const N = 8;
    const data = new Float32Array(5 * N);
    data.set([100, 50, 20, 40, 0.9].map((v) => v), 0);
    [100, 50, 20, 40, 0.9].forEach((v, c) => (data[c * N] = v));
    data[4 * N + 1] = 0.1;
    const out = decodeYolo(data, [1, 5, N], 0.25);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ x1: 90, y1: 30, x2: 110, y2: 70 });
  });

  it('decodes channel-last output and multi-class scores', () => {
    // [1, N=9, C=7]: 3 classes
    const data = new Float32Array(9 * 7);
    data.set([10, 10, 4, 4, 0.1, 0.7, 0], 0);
    data.set([50, 50, 4, 4, 0.2, 0.1, 0], 7);
    data.set([20, 20, 4, 4, 0.0, 0.0, 0.3], 21);
    const out = decodeYolo(data, [1, 9, 7], 0.25);
    expect(out.map((d) => d.score)).toEqual([expect.closeTo(0.7), expect.closeTo(0.3)]);
  });

  it('decodes end-to-end [1, N, 6] xyxy output', () => {
    const N = 10;
    const data = new Float32Array(N * 6);
    data.set([1, 2, 3, 4, 0.8, 0], 0);
    const out = decodeYolo(data, [1, N, 6], 0.5);
    expect(out).toEqual([{ x1: 1, y1: 2, x2: 3, y2: 4, score: expect.closeTo(0.8), kind: 'product' }]);
  });
});

describe('makeTiles', () => {
  it('covers the whole image with overlap', () => {
    const tiles = makeTiles(1024, 2200, 1024);
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: 1024, h: 1024 });
    const last = tiles[tiles.length - 1];
    expect(last.y + last.h).toBe(2200);
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].y).toBeLessThan(tiles[i - 1].y + 1024);
  });
  it('uses one tile when the image fits', () => {
    expect(makeTiles(500, 400, 640)).toEqual([{ x: 0, y: 0, w: 500, h: 400 }]);
  });
});

describe('nms', () => {
  it('suppresses overlapping and contained duplicates', () => {
    const out = nms([det(0, 0, 10, 10, 0.9), det(1, 1, 11, 11, 0.8), det(2, 2, 6, 9, 0.7), det(20, 0, 30, 10, 0.6)]);
    expect(out).toHaveLength(2);
  });
});

describe('sales', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\n"x, y","He said ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'He said "hi"'],
    ]);
  });

  it('derives rank from units and flexible headers', () => {
    const rows = parseSales('Product Name,Unit Sales\nB,"1,000"\nA,5000\nC,10\n');
    expect(rows.map((r) => [r.product, r.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });

  it('accepts rank-only files', () => {
    const rows = parseSales('sku,rank\nX,2\nY,1\n');
    expect(rows[0].product).toBe('Y');
  });

  it('classifies top / core / delist', () => {
    const rows = parseSales('product,units\n' + Array.from({ length: 10 }, (_, i) => `P${i},${100 - i}`).join('\n'));
    const m = classifySales(rows, { topSellerPercent: 20, delistPercent: 20 });
    expect(m.get('p0')?.status).toBe('top');
    expect(m.get('p1')?.status).toBe('top');
    expect(m.get('p2')?.status).toBe('core');
    expect(m.get('p9')?.status).toBe('delist');
  });

  it('normalises names', () => {
    expect(normName('Monster Ultra White 500ml')).toBe(normName('monster-ultra-white-500ML'));
  });
});

describe('recommendations', () => {
  const sales = classifySales(parseSales('product,units\nA,100\nB,90\nC,50\nD,40\nE,30\nF,5\n'), {
    topSellerPercent: 33,
    delistPercent: 20,
  });
  const s = { matchThreshold: 0.8, marginThreshold: 0.02 };
  const mk = (id: number, product: string | null, confidence = 0.95, kind: Det['kind'] = 'product'): Facing => {
    const f: Facing = { ...det(id * 10, 0, id * 10 + 9, 20), kind, id, product, confidence, candidates: product ? [{ product, score: confidence }] : [], status: 'unknown' };
    f.status = statusFor(f, sales, s);
    return f;
  };

  it('colours by sales status and flags low-confidence matches', () => {
    expect(mk(0, 'A').status).toBe('top');
    expect(mk(1, 'F').status).toBe('delist');
    expect(mk(2, 'C').status).toBe('core');
    expect(mk(3, 'A', 0.5).status).toBe('unsure');
    expect(mk(4, null, 0, 'gap').status).toBe('gap');
  });

  it('reports missing top sellers, delist candidates and gaps', () => {
    const facings = [mk(0, 'A'), mk(1, 'F'), mk(2, 'F'), mk(3, 'C'), mk(4, null, 0, 'gap')];
    const recs = recommend(facings, sales, ['A', 'B', 'C', 'D', 'E', 'F']);
    const missing = recs.find((r) => r.kind === 'missing');
    expect(missing?.items?.map((i) => i.name)).toEqual(['B']);
    expect(recs.find((r) => r.kind === 'delist')?.items?.[0].name).toBe('F');
    expect(recs.find((r) => r.kind === 'gap')).toBeTruthy();
    const sum = summarise(facings, sales);
    expect(sum).toMatchObject({ facings: 4, gaps: 1, topSellersPresent: 1, topSellersTotal: 2 });
  });

  it('does not report top sellers as missing when they are not in the catalogue', () => {
    const recs = recommend([mk(0, 'A')], sales, ['A', 'C']);
    expect(recs.find((r) => r.kind === 'missing')).toBeUndefined();
    expect(summarise([mk(0, 'A')], sales, ['A', 'C'])).toMatchObject({ topSellersPresent: 1, topSellersTotal: 1 });
  });
});

describe('detectShelfGrid', () => {
  it('finds rows of packs on a synthetic shelf', () => {
    // 3 shelves of 8 coloured "cans" separated by grey shelf edges.
    const W = 400, H = 420;
    const data = new Uint8ClampedArray(W * H * 4).fill(200);
    const palette = [
      [220, 30, 30],
      [30, 160, 40],
      [30, 60, 200],
      [240, 200, 20],
    ];
    const rowsY = [20, 160, 300];
    for (const [r, y0] of rowsY.entries()) {
      for (let k = 0; k < 8; k++) {
        const [cr, cg, cb] = palette[(k + r) % palette.length];
        const x0 = 10 + k * 48;
        for (let y = y0; y < y0 + 110; y++) {
          for (let x = x0; x < x0 + 44; x++) {
            const p = (y * W + x) * 4;
            // add a stripe so packs have texture
            const stripe = (y - y0) % 30 < 8 ? 60 : 0;
            data[p] = Math.max(0, cr - stripe);
            data[p + 1] = Math.max(0, cg - stripe);
            data[p + 2] = Math.max(0, cb - stripe);
            data[p + 3] = 255;
          }
        }
      }
    }
    const dets = detectShelfGrid({ data, width: W, height: H }).filter((d) => d.kind === 'product');
    const rows = new Set(dets.map((d) => Math.round(d.y1 / 100)));
    expect(rows.size).toBe(3);
    // within ±2 of the 24 packs
    expect(dets.length).toBeGreaterThanOrEqual(22);
    expect(dets.length).toBeLessThanOrEqual(26);
  });
});
