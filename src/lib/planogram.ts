import type { ResolvedMedia } from './media';
import { normName } from './sales';
import type { Facing } from './types';

/**
 * Planogram check: compare what's on the shelf with what the planogram says
 * should be there, product by product and facing by facing. Rules only (no
 * AI guessing): counts come from confidently identified boxes, and unclear
 * boxes that might be a product are reported as "to check", never as found.
 */
export interface PlanogramLine {
  product: string;
  /** Other library names for the same pack (duplicates in the library). */
  also?: string[];
  facings: number;
  /** Shelves it sits on (1 = top). */
  shelves: number[];
}

export interface Planogram {
  id: string;
  title: string;
  item: ResolvedMedia;
  lines: PlanogramLine[];
}

export function planogramsFrom(items: ResolvedMedia[]): Planogram[] {
  return items
    .filter((i) => i.planogram?.shelves?.length)
    .map((i) => {
      const byName = new Map<string, PlanogramLine>();
      i.planogram!.shelves.forEach((shelf, si) => {
        for (const l of shelf ?? []) {
          if (!l?.product || !(l.facings > 0)) continue;
          const k = normName(l.product);
          const cur = byName.get(k);
          if (cur) {
            cur.facings += l.facings;
            if (!cur.shelves.includes(si + 1)) cur.shelves.push(si + 1);
          } else
            byName.set(k, {
              product: l.product,
              also: l.also,
              facings: l.facings,
              shelves: [si + 1],
            });
        }
      });
      return { id: i.id, title: i.title, item: i, lines: [...byName.values()] };
    });
}

export interface PlanogramRow {
  product: string;
  expected: number;
  found: number;
  /** Unclear boxes whose best guesses include this product. */
  maybe: number;
  shelves: number[];
}

export interface PlanogramResult {
  /** Facings in place / facings expected, over the products the app can recognise. */
  score: number;
  placed: number;
  expected: number;
  missing: PlanogramRow[];
  toCheck: PlanogramRow[];
  short: PlanogramRow[];
  ok: PlanogramRow[];
  /** Products confidently found that aren't on the planogram. */
  extra: { product: string; found: number }[];
  /** On the planogram but there are no photos of it in the library yet. */
  uncheckable: PlanogramRow[];
}

const CONFIDENT = new Set(['top', 'core', 'delist', 'nodata']);
/**
 * Planogram prior: the planogram tells us what *should* be on this bay, so
 * when a pack's best match isn't on it but a planogram product is almost as
 * close (same can in another size, sister flavour), count it as the
 * planogram product. Only within a small score margin, so a genuinely
 * different product still shows up as "not on the planogram".
 */
const PRIOR_MARGIN = 0.04;
const PRIOR_MIN_SCORE = 0.62;

/** The product a facing counts as for this planogram, and whether it's sure. */
function labelFor(f: Facing, onPlan: (k: string) => boolean): { product: string; sure: boolean } | null {
  if (f.kind !== 'product' || !f.product) return null;
  const sure = CONFIDENT.has(f.status);
  if (f.corrected || f.viaNeighbour) return { product: f.product, sure };
  // An expected product needs a little less evidence than an unexpected one.
  if (onPlan(normName(f.product))) return { product: f.product, sure: sure || f.confidence >= PRIOR_MIN_SCORE };
  const top = f.candidates[0]?.score ?? f.confidence;
  const alt = f.candidates.find((c) => onPlan(normName(c.product)) && c.score >= top - PRIOR_MARGIN && c.score >= PRIOR_MIN_SCORE);
  if (alt) return { product: alt.product, sure: true };
  return { product: f.product, sure };
}

export function comparePlanogram(pog: Planogram, facings: Facing[], catalogProducts: string[]): PlanogramResult {
  const known = new Set(catalogProducts.map(normName));
  const onPlan = new Set<string>();
  for (const l of pog.lines) for (const n of [l.product, ...(l.also ?? [])]) onPlan.add(normName(n));
  const isOn = (k: string) => onPlan.has(k);
  const found = new Map<string, number>();
  const maybe = new Map<string, number>();
  const extra = new Map<string, { product: string; found: number }>();
  for (const f of facings) {
    const l = labelFor(f, isOn);
    if (l?.sure) {
      const k = normName(l.product);
      found.set(k, (found.get(k) ?? 0) + 1);
      if (!onPlan.has(k)) {
        const e = extra.get(k) ?? { product: l.product, found: 0 };
        e.found++;
        extra.set(k, e);
      }
    } else if (f.kind === 'product' && f.status === 'unsure') {
      const seen = new Set<string>();
      for (const c of f.candidates.slice(0, 2)) {
        const k = normName(c.product);
        if (seen.has(k)) continue;
        seen.add(k);
        maybe.set(k, (maybe.get(k) ?? 0) + 1);
      }
    }
  }

  const res: PlanogramResult = {
    score: 0,
    placed: 0,
    expected: 0,
    missing: [],
    toCheck: [],
    short: [],
    ok: [],
    extra: [],
    uncheckable: [],
  };
  for (const l of pog.lines) {
    const keys = [l.product, ...(l.also ?? [])].map(normName);
    const row: PlanogramRow = {
      product: l.product,
      expected: l.facings,
      found: keys.reduce((n, k) => n + (found.get(k) ?? 0), 0),
      maybe: keys.reduce((n, k) => n + (maybe.get(k) ?? 0), 0),
      shelves: l.shelves,
    };
    if (!keys.some((k) => known.has(k))) {
      res.uncheckable.push(row);
      continue;
    }
    res.expected += row.expected;
    res.placed += Math.min(row.found, row.expected);
    if (row.found >= row.expected) res.ok.push(row);
    else if (row.found > 0) res.short.push(row);
    else if (row.maybe > 0) res.toCheck.push(row);
    else res.missing.push(row);
  }
  res.extra = [...extra.values()];
  res.extra.sort((a, b) => b.found - a.found);
  res.score = res.expected ? res.placed / res.expected : 0;
  return res;
}

export function shelfLabel(shelves: number[]): string {
  return shelves.length > 1 ? `Shelves ${shelves.join(' & ')}` : `Shelf ${shelves[0]}`;
}
