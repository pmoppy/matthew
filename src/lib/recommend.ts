import { normName, type SalesInfo } from './sales';
import type { Facing, Settings, Status } from './types';

export interface Recommendation {
  kind: 'delist' | 'facings' | 'gap' | 'unsure' | 'info';
  title: string;
  detail?: string;
  items?: { name: string; note?: string }[];
}

export interface ShelfSummary {
  facings: number;
  identified: number;
  unsure: number;
  gaps: number;
  products: { name: string; facings: number; status: Status; rank?: number; category?: string }[];
}

export interface TopSellerItem {
  name: string;
  rank: number;
  categoryRank: number;
  category?: string;
  facings: number;
  /** Not confidently found, but an unclear box on the shelf might be it. */
  possible?: boolean;
}

export interface TopSellerCheck {
  hasSales: boolean;
  /** False when too little was recognised to tell what kind of bay this is. */
  bayKnown: boolean;
  /** Categories this bay was judged against (empty = no category data / all). */
  categories: string[];
  missing: TopSellerItem[];
  present: TopSellerItem[];
}

/** Assign the box colour category from the match + sales data. */
export function statusFor(
  f: Pick<Facing, 'kind' | 'product' | 'confidence' | 'corrected' | 'candidates' | 'viaNeighbour'>,
  sales: Map<string, SalesInfo> | null,
  s: Pick<Settings, 'matchThreshold' | 'marginThreshold'>,
): Status {
  if (f.kind === 'gap') return 'gap';
  if (!f.product) return 'unknown';
  if (!f.corrected && !f.viaNeighbour) {
    const second = f.candidates[1]?.score ?? 0;
    if (f.confidence < s.matchThreshold || f.confidence - second < s.marginThreshold) return 'unsure';
  }
  if (!sales || sales.size === 0) return 'nodata';
  return sales.get(normName(f.product))?.status ?? 'nodata';
}

export function summarise(facings: Facing[], sales: Map<string, SalesInfo> | null): ShelfSummary {
  const counts = new Map<string, { facings: number; status: Status }>();
  let identified = 0, unsure = 0, gaps = 0, products = 0;
  for (const f of facings) {
    if (f.kind === 'gap') {
      gaps++;
      continue;
    }
    products++;
    if (f.status === 'unsure') unsure++;
    if (f.product && f.status !== 'unsure' && f.status !== 'unknown') {
      identified++;
      const c = counts.get(f.product) ?? { facings: 0, status: f.status };
      c.facings++;
      counts.set(f.product, c);
    }
  }
  const list = [...counts.entries()].map(([name, c]) => {
    const info = sales?.get(normName(name));
    return { name, facings: c.facings, status: c.status, rank: info?.rank, category: info?.category };
  });
  list.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.facings - a.facings);
  return { facings: products, identified, unsure, gaps, products: list };
}

/**
 * The core question: which of the top sellers that belong on this bay are not
 * on it? Only categories actually present on the shelf are considered, and
 * only products the catalogue can recognise (otherwise "missing" might just
 * mean "we have no photos of it").
 */
export function topSellerCheck(
  facings: Facing[],
  sales: Map<string, SalesInfo> | null,
  catalogProducts: string[],
  /** Category of products that aren't in the sales data (from the library manifest). */
  categoryOf?: (name: string) => string | undefined,
): TopSellerCheck {
  if (!sales || sales.size === 0) return { hasSales: false, bayKnown: false, categories: [], missing: [], present: [] };
  const sum = summarise(facings, sales);
  const present = new Map(sum.products.map((p) => [normName(p.name), p]));

  // Which categories is this bay? Count confidently identified facings.
  const catCount = new Map<string, { label: string; n: number }>();
  let catTotal = 0;
  for (const p of sum.products) {
    const cat = p.category ?? categoryOf?.(p.name);
    if (!cat) continue;
    const k = normName(cat);
    const c = catCount.get(k) ?? { label: cat, n: 0 };
    c.n += p.facings;
    catCount.set(k, c);
    catTotal += p.facings;
  }
  let bayCats = [...catCount.entries()]
    .filter(([, c]) => c.n >= 2 && c.n >= catTotal * 0.12)
    .sort((a, b) => b[1].n - a[1].n);
  // Hard photo (angle, glare): few confident names. Fall back to the best
  // guesses for the unclear boxes; even when unsure *which* Monster it is,
  // "it's an energy drink" is usually right. Needs a clear majority.
  if (!bayCats.length) {
    const guess = new Map<string, { label: string; n: number }>();
    let total = 0;
    for (const f of facings) {
      if (f.kind !== 'product' || !f.product) continue;
      const cat = sales.get(normName(f.product))?.category ?? categoryOf?.(f.product);
      if (!cat) continue;
      const k = normName(cat);
      const g = guess.get(k) ?? { label: cat, n: 0 };
      g.n++;
      guess.set(k, g);
      total++;
    }
    bayCats = [...guess.entries()].filter(([, g]) => g.n >= 4 && g.n >= total * 0.5).sort((a, b) => b[1].n - a[1].n).slice(0, 1);
  }
  const catKeys = new Set(bayCats.map(([k]) => k));
  const hasCategories = [...sales.values()].some((v) => v.category);
  // With categorised sales data, never judge a bay against every category at once.
  if (hasCategories && catKeys.size === 0) return { hasSales: true, bayKnown: false, categories: [], missing: [], present: [] };
  const inBay = (v: SalesInfo) => !hasCategories || (v.category ? catKeys.has(normName(v.category)) : false);

  // Products that unclear boxes might be (top-2 candidates).
  const maybe = new Set<string>();
  for (const f of facings) {
    if (f.status !== 'unsure') continue;
    for (const c of f.candidates.slice(0, 2)) maybe.add(normName(c.product));
  }

  const known = new Set(catalogProducts.map(normName));
  const tops = [...sales.values()]
    .filter((v) => v.status === 'top' && inBay(v) && (known.size === 0 || known.has(normName(v.name))))
    .sort((a, b) => a.categoryRank - b.categoryRank || a.rank - b.rank);

  const item = (v: SalesInfo, facingsN: number, possible?: boolean): TopSellerItem => ({
    name: v.name,
    rank: v.rank,
    categoryRank: v.categoryRank,
    category: v.category,
    facings: facingsN,
    possible,
  });
  return {
    hasSales: true,
    bayKnown: true,
    categories: bayCats.map(([, c]) => c.label),
    present: tops.filter((v) => present.has(normName(v.name))).map((v) => item(v, present.get(normName(v.name))!.facings)),
    missing: tops
      .filter((v) => !present.has(normName(v.name)))
      .map((v) => item(v, 0, maybe.has(normName(v.name))))
      // Definitely-missing first, then "maybe".
      .sort((a, b) => Number(!!a.possible) - Number(!!b.possible) || a.categoryRank - b.categoryRank),
  };
}

/** Secondary advice once the top-seller check is done. */
export function recommend(facings: Facing[], sales: Map<string, SalesInfo> | null): Recommendation[] {
  const recs: Recommendation[] = [];
  const sum = summarise(facings, sales);

  if (sales && sales.size) {
    const topLow = sum.products.filter((p) => p.status === 'top' && p.facings === 1);
    const slowWide = sum.products.filter((p) => (p.status === 'delist' || p.status === 'core') && p.facings >= 3);
    if (topLow.length && slowWide.length) {
      recs.push({
        kind: 'facings',
        title: 'Give top sellers more space',
        detail: `Move facings from ${slowWide
          .slice(0, 3)
          .map((p) => `${p.name} (${p.facings})`)
          .join(', ')} to these top sellers, which only have one facing.`,
        items: topLow.map((p) => ({ name: p.name })),
      });
    }
  }
  if (sum.gaps) {
    recs.push({
      kind: 'gap',
      title: `${sum.gaps} empty space${sum.gaps > 1 ? 's' : ''} on the shelf`,
      detail: 'Possible out-of-stocks. Fill them with the missing top sellers.',
    });
  }
  return recs;
}
