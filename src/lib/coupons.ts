import { useEffect, useState } from 'react';
import { join, sources } from './media';

/**
 * Retailer coupons: wholesaler offers (e.g. "buy 2 cases of Monster, save £5")
 * a retailer can pick and turn into a pre-filled order basket. The list is
 * media/coupons.json, read live like the media hub, so campaigns change
 * without an app update. Prices and offers in the starter file are samples.
 */
export interface Coupon {
  id: string;
  brand: string;
  title: string;
  /** Short headline on the coupon ("Save £5", "3 for £30"). */
  offer: string;
  product: string;
  pack: string;
  casePrice: number;
  /** Cases needed for the coupon to apply. */
  minCases: number;
  /** Saving in £ when at least minCases are ordered. */
  saving: number;
  ends?: string;
  image?: string;
  colour?: string;
  /** Paid placement: shown first, with a star, under "Featured offers". */
  featured?: boolean;
  imageUrl?: string;
}

/** The offers plus the retailer's cashback balance. */
export interface CouponFeed {
  coupons: Coupon[];
  balance: number;
  balanceNote?: string;
}

const LIST_KEY = 'shelfscan.coupons.v2';
const BASKET_KEY = 'shelfscan.basket';

function valid(c: unknown): c is Coupon {
  const x = c as Coupon;
  return !!x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.casePrice === 'number' && x.minCases > 0;
}

const EMPTY: CouponFeed = { coupons: [], balance: 0 };

function cached(): CouponFeed {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null') as CouponFeed | null;
    return v && Array.isArray(v.coupons) ? { ...v, coupons: v.coupons.filter(valid) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Featured (paid) offers first, then the rest in file order; expired ones dropped. */
function current(feed: CouponFeed): CouponFeed {
  const today = new Date().toISOString().slice(0, 10);
  const live = feed.coupons.filter((c) => !c.ends || c.ends >= today);
  return { ...feed, coupons: [...live.filter((c) => c.featured), ...live.filter((c) => !c.featured)] };
}

let loading: Promise<CouponFeed> | null = null;

/** Live list first, then the last list seen, then the one built into the app. Expired coupons are dropped. */
export function fetchCoupons(libraryBase: string): Promise<CouponFeed> {
  loading ??= (async () => {
    for (const base of sources(libraryBase)) {
      try {
        const res = await fetch(`${base}/coupons.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const body = (await res.json()) as { coupons?: unknown[]; balance?: number; balanceNote?: string };
        const feed: CouponFeed = {
          coupons: (body.coupons ?? []).filter(valid).map((c) => ({ ...c, imageUrl: c.image ? join(base, c.image) : undefined })),
          balance: typeof body.balance === 'number' ? body.balance : 0,
          balanceNote: body.balanceNote,
        };
        try {
          localStorage.setItem(LIST_KEY, JSON.stringify(feed));
        } catch {
          /* ignore */
        }
        return current(feed);
      } catch {
        /* offline: try the next source */
      }
    }
    return current(cached());
  })();
  return loading;
}

export function useCoupons(libraryBase: string): CouponFeed {
  const [list, setList] = useState<CouponFeed>(() => current(cached()));
  useEffect(() => {
    let live = true;
    fetchCoupons(libraryBase).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [libraryBase]);
  return list;
}

/** Basket: coupon id -> cases. */
export type Basket = Record<string, number>;

export function loadBasket(): Basket {
  try {
    return JSON.parse(localStorage.getItem(BASKET_KEY) ?? '{}') as Basket;
  } catch {
    return {};
  }
}

export function saveBasket(b: Basket) {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

export interface BasketLine {
  coupon: Coupon;
  cases: number;
  cost: number;
  /** Saving applied (0 when fewer than minCases). */
  saving: number;
}

export function basketLines(basket: Basket, coupons: Coupon[]): BasketLine[] {
  return coupons
    .filter((c) => basket[c.id] > 0)
    .map((c) => {
      const cases = basket[c.id];
      return { coupon: c, cases, cost: cases * c.casePrice, saving: cases >= c.minCases ? c.saving : 0 };
    });
}

export function basketTotals(lines: BasketLine[]) {
  const subtotal = lines.reduce((n, l) => n + l.cost, 0);
  const savings = lines.reduce((n, l) => n + l.saving, 0);
  return { subtotal, savings, total: subtotal - savings, cases: lines.reduce((n, l) => n + l.cases, 0) };
}

export const money = (n: number) => `£${n.toFixed(2)}`;

/** Plain-text order to send to the wholesaler (share sheet / clipboard). */
export function orderText(lines: BasketLine[], store?: string): string {
  const t = basketTotals(lines);
  return [
    `Order${store ? ` for ${store}` : ''} (ShelfScan)`,
    '',
    ...lines.map(
      (l) =>
        `${l.cases} x ${l.coupon.product} (${l.coupon.pack}) ${money(l.cost)}${l.saving ? `  coupon "${l.coupon.offer}": -${money(l.saving)}` : ''}`,
    ),
    '',
    `Subtotal ${money(t.subtotal)}`,
    `Coupon savings -${money(t.savings)}`,
    `Total ${money(t.total)}`,
  ].join('\n');
}
