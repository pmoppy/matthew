import { normName, type SalesInfo } from './sales';

/**
 * Product "families": the same product in different sizes or pack formats
 * (Coca-Cola 150ml / 330ml / 330ml x 24pk, Monster 500ml / Mega 558ml).
 * Their packs look identical, so a photo can't tell them apart. When judging
 * whether a match is clear, compare against the best *other* product, not
 * against the same product in another size.
 */
const SIZE = /\b\d+(\.\d+)?\s*(ml|cl|l|ltr|g|kg|pk|s)\b|\bx\s*\d+\b|\b\d+\s*x\b/g;
const IGNORE = new Set(['can', 'cans', 'btl', 'bottle', 'pet', 'pmp', 'pm', 'multipack', 'bag', 'pouch', 'mega', 'mini', 'x', 'original', 'taste', 'energy', 'drink', 'the', 'and']);

export function familyWords(name: string): Set<string> {
  const t = name.toLowerCase().replace(/&/g, ' and ').replace(/coca[\s-]?cola/g, 'coke').replace(/\bpm\s*£?\d*(\.\d+)?\b/g, ' ').replace(SIZE, ' ');
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

/**
 * Re-order match candidates: the chosen product first (within the top
 * family, a size that's on the sales list wins if it's nearly as close),
 * then other products, then the rest of the family. The second entry is
 * therefore the best different product, which is what the confidence
 * margin should be measured against.
 */
export function familyOrder<T extends { product: string; score: number }>(m: T[], sales: Map<string, SalesInfo> | null): T[] {
  if (m.length < 2) return m;
  const top = m[0];
  const fam = m.filter((c) => sameFamily(c.product, top.product));
  const other = m.filter((c) => !fam.includes(c));
  const pick = (sales && fam.find((c) => sales.has(normName(c.product)) && c.score >= top.score - 0.04)) || top;
  // Keep the evidence (best score) on the chosen product.
  const chosen = { ...pick, score: top.score };
  return [chosen, ...other, ...fam.filter((c) => c !== pick)];
}
