import type { SalesRow, Settings, Status } from './types';

/** Normalise a product name so "Monster Ultra White 500ml" ≈ "monster-ultra-white-500ML". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** Minimal RFC-4180 CSV parser (quoted fields, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const NAME_COLS = ['product', 'productname', 'name', 'description', 'item', 'sku', 'skuname', 'folder'];
const UNIT_COLS = ['units', 'unitsales', 'sales', 'qty', 'quantity', 'volume', 'value', 'revenue', 'salesvalue', 'rsv'];
const RANK_COLS = ['rank', 'ranking', 'position'];
const CAT_COLS = ['category', 'subcategory', 'segment', 'department'];
const STATUS_COLS = ['status', 'flag', 'role'];

/**
 * Accepts a CSV with a product column (matching the catalogue folder names)
 * plus a units/value column and/or a rank column. Header names are flexible.
 */
export function parseSales(text: string): SalesRow[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The sales file needs a header row and at least one product.');
  const header = rows[0].map((h) => normName(h));
  const find = (cands: string[]) => {
    for (const c of cands) {
      const i = header.indexOf(c);
      if (i >= 0) return i;
    }
    return header.findIndex((h) => cands.some((c) => h.includes(c)));
  };
  const ni = find(NAME_COLS);
  const ui = find(UNIT_COLS);
  const ri = find(RANK_COLS);
  const ci = header.findIndex((h) => CAT_COLS.includes(h));
  const si = header.findIndex((h) => STATUS_COLS.includes(h));
  if (ni < 0) throw new Error('Could not find a product name column (e.g. "product").');
  if (ui < 0 && ri < 0) throw new Error('Could not find a "units" or "rank" column.');
  const num = (s: string | undefined) => Number(String(s ?? '').replace(/[£$€,\s]/g, ''));
  const out: SalesRow[] = [];
  for (const r of rows.slice(1)) {
    const product = (r[ni] ?? '').trim();
    if (!product) continue;
    const units = ui >= 0 ? num(r[ui]) : NaN;
    const rank = ri >= 0 ? num(r[ri]) : NaN;
    const category = ci >= 0 ? (r[ci] ?? '').trim() || undefined : undefined;
    const st = si >= 0 ? normName(r[si] ?? '') : '';
    const status = st.startsWith('top') || st === 'mustcarry' || st === 'muststock' ? 'top' : st.startsWith('delist') ? 'delist' : st === 'core' ? 'core' : undefined;
    out.push({ product, units: Number.isFinite(units) ? units : 0, rank: Number.isFinite(rank) ? rank : 0, category, status });
  }
  // Derive rank from units when not supplied (1 = best seller).
  if (ri < 0) {
    [...out].sort((a, b) => b.units - a.units).forEach((r, i) => (r.rank = i + 1));
  } else if (ui < 0) {
    out.forEach((r) => (r.units = Math.max(0, out.length - r.rank + 1)));
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export interface SalesInfo {
  rank: number;
  /** Rank within its category (equals rank when there are no categories). */
  categoryRank: number;
  units: number;
  status: Extract<Status, 'top' | 'core' | 'delist'>;
  name: string;
  category?: string;
}

/**
 * Classify every product as top seller / core / delist candidate. When the
 * data has categories, the percentages apply within each category, so an
 * energy bay is judged against the best energy drinks, not against cola.
 */
export function classifySales(rows: SalesRow[], s: Pick<Settings, 'topSellerPercent' | 'delistPercent'>): Map<string, SalesInfo> {
  const groups = new Map<string, SalesRow[]>();
  for (const r of rows) {
    const k = r.category ? normName(r.category) : '';
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const m = new Map<string, SalesInfo>();
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.rank - b.rank);
    const n = sorted.length;
    const topN = Math.max(1, Math.ceil((n * s.topSellerPercent) / 100));
    const delistN = Math.floor((n * s.delistPercent) / 100);
    sorted.forEach((r, i) => {
      const pos = i + 1;
      // An explicit status column (top / core / delist) overrides the percentages.
      const status = r.status ?? (pos <= topN ? 'top' : pos > n - delistN ? 'delist' : 'core');
      m.set(normName(r.product), { rank: r.rank || pos, categoryRank: pos, units: r.units, status, name: r.product, category: r.category });
    });
  }
  return m;
}
