import { describe, expect, it } from 'vitest';
import { detectShelfGrid } from '../detect/heuristic';
import { nms } from '../detect/nms';
import { decodeYolo, makeTiles } from '../detect/yolo';
import { recommend, statusFor, summarise, topSellerCheck } from '../recommend';
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

  it('detects semicolon and tab separated files without splitting on commas inside names', () => {
    expect(parseCsv('product;units\nFoo, Bar 500ml;10\n')).toEqual([
      ['product', 'units'],
      ['Foo, Bar 500ml', '10'],
    ]);
    expect(parseCsv('product\tunits\nA;B\t3\n')[1]).toEqual(['A;B', '3']);
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

describe('top-seller check', () => {
  const sales = classifySales(parseSales('product,units\nA,100\nB,90\nC,50\nD,40\nE,30\nF,5\n'), {
    topSellerPercent: 33,
    delistPercent: 20,
  });
  const s = { matchThreshold: 0.8, marginThreshold: 0.02 };
  const mk = (id: number, product: string | null, confidence = 0.95, kind: Det['kind'] = 'product', sm = sales, cands?: Facing['candidates']): Facing => {
    const f: Facing = { ...det(id * 10, 0, id * 10 + 9, 20), kind, id, product, confidence, candidates: cands ?? (product ? [{ product, score: confidence }] : []), status: 'unknown' };
    f.status = statusFor(f, sm, s);
    return f;
  };

  it('colours by sales status and flags low-confidence matches', () => {
    expect(mk(0, 'A').status).toBe('top');
    expect(mk(1, 'F').status).toBe('delist');
    expect(mk(2, 'C').status).toBe('core');
    expect(mk(3, 'A', 0.5).status).toBe('unsure');
    expect(mk(4, null, 0, 'gap').status).toBe('gap');
  });

  it('reports missing top sellers, present ones and secondary advice', () => {
    const facings = [mk(0, 'A'), mk(1, 'F'), mk(2, 'F'), mk(3, 'C'), mk(4, null, 0, 'gap')];
    const check = topSellerCheck(facings, sales, ['A', 'B', 'C', 'D', 'E', 'F']);
    expect(check.missing.map((m) => [m.name, m.possible])).toEqual([['B', false]]);
    expect(check.present.map((m) => m.name)).toEqual(['A']);
    const recs = recommend(facings, sales);
    expect(summarise(facings, sales).products.find((p) => p.status === 'delist')?.name).toBe('F');
    expect(recs.find((r) => r.kind === 'gap')).toBeTruthy();
    expect(summarise(facings, sales)).toMatchObject({ facings: 4, gaps: 1 });
  });

  it('marks a missing top seller as "possible" when an unclear box might be it', () => {
    const unclear = mk(5, 'C', 0.5, 'product', sales, [
      { product: 'C', score: 0.5 },
      { product: 'B', score: 0.49 },
    ]);
    const check = topSellerCheck([mk(0, 'A'), unclear], sales, []);
    expect(check.missing).toEqual([expect.objectContaining({ name: 'B', possible: true })]);
  });

  it('does not report top sellers as missing when they are not in the catalogue', () => {
    expect(topSellerCheck([mk(0, 'A')], sales, ['A', 'C']).missing).toEqual([]);
  });

  it('only checks top sellers from the categories on the bay', () => {
    const cat = classifySales(
      parseSales('product,units,category\nCola 1,100,Cola\nCola 2,90,Cola\nCola 3,10,Cola\nEnergy 1,80,Energy\nEnergy 2,70,Energy\nEnergy 3,5,Energy\n'),
      { topSellerPercent: 34, delistPercent: 0 },
    );
    // An energy bay with Energy 1 on it: Energy 2 is missing, the cola top sellers are not this bay's business.
    const facings = [mk(0, 'Energy 1', 0.95, 'product', cat), mk(1, 'Energy 1', 0.95, 'product', cat), mk(2, 'Energy 3', 0.95, 'product', cat)];
    const check = topSellerCheck(facings, cat, []);
    expect(check.categories).toEqual(['Energy']);
    expect(check.missing.map((m) => m.name)).toEqual(['Energy 2']);
    expect(check.present.map((m) => m.name)).toEqual(['Energy 1']);
  });

  it('honours an explicit status column', () => {
    const m = classifySales(parseSales('product,units,status\nX,100,core\nY,1,top\n'), { topSellerPercent: 50, delistPercent: 0 });
    expect(m.get('x')?.status).toBe('core');
    expect(m.get('y')?.status).toBe('top');
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

describe('edge fragments', () => {
  it('drops narrow boxes cut off by the photo edge but keeps full packs', async () => {
    const { dropEdgeFragments } = await import('../analyse');
    const row = [0, 1, 2, 3].map((i) => det(100 + i * 50, 0, 140 + i * 50, 100));
    const sliver = det(0, 0, 12, 100); // cut off at the left edge
    const fullAtEdge = det(560, 0, 600, 100); // touches the right edge but full width
    const out = dropEdgeFragments([...row, sliver, fullAtEdge], 600);
    expect(out).toHaveLength(5);
    expect(out).not.toContain(sliver);
  });
});

describe('split bottles', () => {
  it('merges a label box with the bottle bottom directly below, but not two stacked cans', async () => {
    const { mergeSplitBottles } = await import('../analyse');
    const label = det(100, 0, 160, 110);
    const bottom = det(102, 112, 158, 180);
    expect(mergeSplitBottles([label, bottom])).toHaveLength(1);
    const can1 = det(300, 0, 360, 110);
    const can2 = det(300, 112, 360, 222);
    expect(mergeSplitBottles([can1, can2])).toHaveLength(2);
  });
});

describe('bay detection on hard photos', () => {
  const cat = classifySales(
    parseSales('product,units,category\nCola 1,100,Cola\nCola 2,90,Cola\nEnergy 1,80,Energy\nEnergy 2,70,Energy\nEnergy 3,60,Energy\nCrisp 1,50,Crisps\n'),
    { topSellerPercent: 40, delistPercent: 0 },
  );
  const unsure = (id: number, guess: string): Facing => ({
    ...det(id * 10, 0, id * 10 + 9, 20), id, product: guess, confidence: 0.6,
    candidates: [{ product: guess, score: 0.6 }, { product: 'Cola 1', score: 0.55 }], status: 'unsure',
  });
  it('uses best guesses of unclear boxes to find the bay instead of listing every category', () => {
    const facings = [0, 1, 2, 3, 4].map((i) => unsure(i, i % 2 ? 'Energy 2' : 'Energy 3'));
    const check = topSellerCheck(facings, cat, []);
    expect(check.bayKnown).toBe(true);
    expect(check.categories).toEqual(['Energy']);
    expect(check.missing.every((m) => m.category === 'Energy')).toBe(true);
  });
  it('says it cannot check the bay when nothing points to a category', () => {
    const check = topSellerCheck([unsure(0, 'Energy 2'), unsure(1, 'Crisp 1')], cat, []);
    expect(check.bayKnown).toBe(false);
    expect(check.missing).toEqual([]);
  });
});

import { familyOrder, sameFamily } from '../family';

describe('product families', () => {
  it('treats sizes and pack formats of one product as one family', () => {
    expect(sameFamily('Coca-Cola Original Taste 330ml', 'Coca-Cola Original Taste 150ml')).toBe(true);
    expect(sameFamily('Coca Cola 330ml x 24pk', 'Coca-Cola Original Taste 330ml')).toBe(true);
    expect(sameFamily('Monster Energy Mega 558ml Can', 'Monster Energy Original 500ml')).toBe(true);
    expect(sameFamily('Monster Pipeline Punch 500ml', 'Monster Energy Original 500ml')).toBe(false);
    expect(sameFamily('Doritos 3D Nacho Cheese 70g PM', 'Doritos 3D Nacho Cheese 70g')).toBe(true);
    expect(sameFamily('Rubicon Raw Energy Zero Cherry 500ml Can Pm1.00', 'Rubicon Raw Energy Zero Cherry 500ml Can')).toBe(true);
    expect(sameFamily('Diet Coke 330ml', 'Coca-Cola Original Taste 330ml')).toBe(false);
    expect(sameFamily('Monster Pipeline Punch 500ml', 'Monster Pacific Punch 500ml')).toBe(false);
    expect(sameFamily('Diet Coke 500ml', 'Coca-Cola Zero Sugar 500ml')).toBe(false);
  });
  it('measures the margin against a different product and prefers a ranked size', () => {
    const sales = new Map([['cocacolaoriginaltaste330ml', { rank: 3 } as never]]);
    const m = familyOrder(
      [
        { product: 'Coca-Cola Original Taste 150ml', score: 0.81 },
        { product: 'Coca-Cola Original Taste 330ml', score: 0.8 },
        { product: 'Diet Coke 330ml', score: 0.7 },
      ],
      sales,
    );
    expect(m[0]).toEqual({ product: 'Coca-Cola Original Taste 330ml', score: 0.81 });
    expect(m[1].product).toBe('Diet Coke 330ml');
  });
});
