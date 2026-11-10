import type { Facing } from './types';

/**
 * Sizes of one product (Coca-Cola 150ml mini can / 330ml can, Monster 500ml /
 * Mega 558ml) are different SKUs with the same artwork. The recognition model
 * squashes every pack into a square, so it can't see the difference: shape
 * has to. Each library product has a typical height/width ("aspect") from its
 * reference photos; the box on the shelf has one too. The size whose shape
 * fits best wins, and when the shapes are too close to call the box asks the
 * rep to confirm the size instead of guessing.
 */
const SIZE = /\b\d+(\.\d+)?\s*(ml|cl|l|ltr|g|kg|pk|s)\b|\bx\s*\d+\b|\b\d+\s*x\b/g;
const IGNORE = new Set(['can', 'cans', 'btl', 'bottle', 'pet', 'pmp', 'pm', 'multipack', 'bag', 'pouch', 'mega', 'mini', 'x', 'original', 'taste', 'energy', 'drink', 'the', 'and']);

export function familyWords(name: string): Set<string> {
  const t = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/coca[\s-]?cola/g, 'coke')
    .replace(/\bpm\s*£?\d*(\.\d+)?\b/g, ' ')
    .replace(SIZE, ' ');
  return new Set((t.match(/[a-z0-9]+/g) ?? []).filter((w) => !IGNORE.has(w)));
}

/**
 * Same family when the names match once sizes, price marks and pack words are
 * dropped. Exact match only: "Diet Coke" or "Monster Pipeline Punch" contain
 * the words of "Coca-Cola" / "Monster" but are different products.
 */
export function sameFamily(a: string, b: string): boolean {
  const A = familyWords(a);
  const B = familyWords(b);
  if (!A.size || A.size !== B.size) return false;
  for (const w of A) if (!B.has(w)) return false;
  return true;
}

/** Sizes within this score of the best match are all considered. */
const FAMILY_WINDOW = 0.05;
/** Shapes must differ by about this much (log ratio) to pick a size. */
const SHAPE_MARGIN = 0.05;

type Cand = { product: string; score: number };

/**
 * Settle sizes for a whole photo. Shelf boxes are usually a little taller than
 * the reference photos (camera angle, box padding), so the photo is calibrated
 * first on packs whose size isn't in doubt.
 */
export function resolveSizes(facings: Facing[], aspects: Record<string, number>) {
  const info = facings.map((f) => {
    const m = f.candidates;
    const top = m[0];
    if (!top) return null;
    const fam = m.filter((c) => c.score >= top.score - FAMILY_WINDOW && sameFamily(c.product, top.product));
    return { f, top, fam, aspect: (f.y2 - f.y1) / Math.max(1, f.x2 - f.x1) };
  });

  const ratios: number[] = [];
  for (const x of info) if (x && x.fam.length === 1 && aspects[x.top.product]) ratios.push(x.aspect / aspects[x.top.product]);
  ratios.sort((a, b) => a - b);
  const bias = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : 1;

  for (const x of info) {
    if (!x) continue;
    const { f, top, fam } = x;
    const others = f.candidates.filter((c) => !sameFamily(c.product, top.product));
    if (fam.length < 2) {
      // Margin is measured against a different product, never another size of this one.
      f.candidates = [top, ...others, ...f.candidates.filter((c) => c !== top && !others.includes(c))];
      continue;
    }
    const fit = (c: Cand) => (aspects[c.product] ? Math.abs(Math.log(x.aspect / (bias * aspects[c.product]))) : Infinity);
    const ranked = [...fam].sort((a, b) => fit(a) - fit(b));
    const best = ranked[0];
    const clear = fit(best) !== Infinity && fit(ranked[1]) - fit(best) >= SHAPE_MARGIN;
    const chosen: Cand = { ...(clear ? best : top), score: top.score };
    const rest = fam.filter((c) => c.product !== chosen.product);
    // Unclear size: the other sizes come straight after, so the rep sees them first.
    f.candidates = clear ? [chosen, ...others, ...rest] : [chosen, ...rest, ...others];
    f.product = chosen.product;
    f.confidence = chosen.score;
    f.sizeCheck = !clear;
  }
}
