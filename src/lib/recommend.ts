import { normName, type SalesInfo } from './sales';
import type { Facing, Settings, Status } from './types';

export interface Recommendation {
  kind: 'missing' | 'delist' | 'facings' | 'gap' | 'unsure' | 'info' | 'good';
  title: string;
  detail?: string;
  items?: { name: string; note?: string }[];
}

export interface ShelfSummary {
  facings: number;
  identified: number;
  unsure: number;
  gaps: number;
  topSellersPresent: number;
  topSellersTotal: number;
  products: { name: string; facings: number; status: Status; rank?: number }[];
}

/** Assign the box colour category from the match + sales data. */
export function statusFor(
  f: Pick<Facing, 'kind' | 'product' | 'confidence' | 'corrected' | 'candidates'>,
  sales: Map<string, SalesInfo> | null,
  s: Pick<Settings, 'matchThreshold' | 'marginThreshold'>,
): Status {
  if (f.kind === 'gap') return 'gap';
  if (!f.product) return 'unknown';
  if (!f.corrected) {
    const second = f.candidates[1]?.score ?? 0;
    if (f.confidence < s.matchThreshold || f.confidence - second < s.marginThreshold) return 'unsure';
  }
  if (!sales || sales.size === 0) return 'nodata';
  return sales.get(normName(f.product))?.status ?? 'nodata';
}

/**
 * `catalogProducts` limits top-seller counts to products the app can
 * recognise; a top seller with no catalogue photos can never be "found".
 */
export function summarise(facings: Facing[], sales: Map<string, SalesInfo> | null, catalogProducts?: string[]): ShelfSummary {
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
  const list = [...counts.entries()].map(([name, c]) => ({
    name,
    facings: c.facings,
    status: c.status,
    rank: sales?.get(normName(name))?.rank,
  }));
  list.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.facings - a.facings);
  const known = catalogProducts?.length ? new Set(catalogProducts.map(normName)) : null;
  const tops = sales ? [...sales.values()].filter((v) => v.status === 'top' && (!known || known.has(normName(v.name)))) : [];
  const present = new Set(list.map((p) => normName(p.name)));
  return {
    facings: products,
    identified,
    unsure,
    gaps,
    topSellersPresent: tops.filter((t) => present.has(normName(t.name))).length,
    topSellersTotal: tops.length,
    products: list,
  };
}

/** Turn the identified shelf into actionable ranging advice, focused on top sellers. */
export function recommend(
  facings: Facing[],
  sales: Map<string, SalesInfo> | null,
  catalogProducts: string[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const sum = summarise(facings, sales, catalogProducts);
  const present = new Map(sum.products.map((p) => [normName(p.name), p]));

  if (!catalogProducts.length) {
    recs.push({
      kind: 'info',
      title: 'Load your product catalogue to identify SKUs',
      detail: 'Go to Catalogue and connect your image bucket, or pick a local folder of product photos.',
    });
  }
  if (!sales || sales.size === 0) {
    recs.push({
      kind: 'info',
      title: 'Add sales data to find top sellers',
      detail: 'Upload a CSV with product and units (or rank) columns on the Catalogue tab.',
    });
  }

  if (sales && sales.size) {
    // 1. Missing top sellers – the headline insight. Only flag products the
    // catalogue can recognise, otherwise "missing" might just mean "unknown to us".
    const known = new Set(catalogProducts.map(normName));
    const missing = [...sales.values()]
      .filter((v) => v.status === 'top' && !present.has(normName(v.name)))
      .sort((a, b) => a.rank - b.rank);
    const missingKnown = missing.filter((m) => known.size === 0 || known.has(normName(m.name)));
    if (missingKnown.length) {
      recs.push({
        kind: 'missing',
        title: `${missingKnown.length} top seller${missingKnown.length > 1 ? 's' : ''} not found on this shelf`,
        detail:
          sum.unsure > 0
            ? `Check the ${sum.unsure} amber boxes first. A missing top seller may be one of them.`
            : 'Consider ranging these, using space freed by the slow sellers below.',
        items: missingKnown.slice(0, 15).map((m) => ({ name: m.name, note: `Rank #${m.rank}` })),
      });
    } else if (sum.topSellersTotal) {
      recs.push({ kind: 'good', title: 'All top sellers are on the shelf' });
    }

    // 2. Delist candidates that are taking space.
    const delist = sum.products.filter((p) => p.status === 'delist');
    if (delist.length) {
      recs.push({
        kind: 'delist',
        title: `${delist.length} slow seller${delist.length > 1 ? 's' : ''} to consider removing`,
        detail: 'These are in the bottom of your sales ranking but take up shelf space.',
        items: delist.map((p) => ({ name: p.name, note: `Rank #${p.rank} · ${p.facings} facing${p.facings > 1 ? 's' : ''}` })),
      });
    }

    // 3. Facing balance: top sellers with fewer facings than slow sellers.
    const topLow = sum.products.filter((p) => p.status === 'top' && p.facings === 1);
    const slowWide = sum.products.filter((p) => (p.status === 'delist' || p.status === 'core') && p.facings >= 3);
    if (topLow.length && slowWide.length) {
      recs.push({
        kind: 'facings',
        title: 'Rebalance facings towards top sellers',
        detail: `Move facings from ${slowWide
          .slice(0, 3)
          .map((p) => `${p.name} (${p.facings})`)
          .join(', ')} to top sellers with only one facing.`,
        items: topLow.map((p) => ({ name: p.name, note: `Rank #${p.rank} · 1 facing` })),
      });
    }
  }

  if (sum.gaps) {
    recs.push({
      kind: 'gap',
      title: `${sum.gaps} empty space${sum.gaps > 1 ? 's' : ''} on the shelf`,
      detail: 'Possible out-of-stocks. Refill them, ideally with the missing top sellers.',
    });
  }
  if (sum.unsure) {
    recs.push({
      kind: 'unsure',
      title: `${sum.unsure} product${sum.unsure > 1 ? 's' : ''} need checking`,
      detail: 'Tap an amber box to confirm or correct it. Each correction teaches the app that product.',
    });
  }
  return recs;
}
