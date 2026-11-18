/** Datasets Panko can read, and the small query engine its tools run on. */

export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type ColType = 'number' | 'date' | 'text';

export interface Column {
  name: string;
  type: ColType;
}

export interface Dataset {
  id: string;
  name: string;
  source: string;
  addedAt: string;
  columns: Column[];
  rows: Row[];
}

// ---------- loading ----------

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC-4180 CSV parser (quoted fields, CRLF, auto-detected delimiter). */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const delim = detectDelimiter(text);
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
    else if (c === delim) {
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

const NUM = /^-?[£$€]?-?\d{1,3}(,?\d{3})*(\.\d+)?%?$|^-?[£$€]?-?\d*\.?\d+%?$/;
const DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function toNumber(s: string): number {
  return Number(s.replace(/[£$€,%\s]/g, ''));
}

/** dd/mm/yyyy (UK) → yyyy-mm-dd so dates sort and compare as text. */
function normDate(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return s.slice(0, 10);
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function inferType(values: string[]): ColType {
  const v = values.map((x) => x.trim()).filter((x) => x !== '');
  if (!v.length) return 'text';
  if (v.every((x) => NUM.test(x))) return 'number';
  if (v.every((x) => DATE.test(x))) return 'date';
  return 'text';
}

export function cleanHeader(h: string, i: number, seen: Set<string>): string {
  let name = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `column_${i + 1}`;
  while (seen.has(name)) name += '_2';
  seen.add(name);
  return name;
}

export function tableToDataset(table: string[][], name: string, source: string): Dataset {
  if (table.length < 2) throw new Error('The file needs a header row and at least one data row.');
  const seen = new Set<string>();
  const headers = table[0].map((h, i) => cleanHeader(h, i, seen));
  const body = table.slice(1);
  const columns: Column[] = headers.map((h, i) => ({ name: h, type: inferType(body.map((r) => r[i] ?? '')) }));
  const rows: Row[] = body.map((r) => {
    const o: Row = {};
    columns.forEach((c, i) => {
      const raw = (r[i] ?? '').trim();
      if (raw === '') o[c.name] = null;
      else if (c.type === 'number') o[c.name] = toNumber(raw);
      else if (c.type === 'date') o[c.name] = normDate(raw);
      else o[c.name] = raw;
    });
    return o;
  });
  return { id: crypto.randomUUID(), name, source, addedAt: new Date().toISOString(), columns, rows };
}

export function parseFile(text: string, fileName: string): Dataset {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Data';
  if (/\.json$/i.test(fileName)) {
    const data = JSON.parse(text);
    const arr: Record<string, unknown>[] = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) ?? [];
    if (!arr.length || typeof arr[0] !== 'object') throw new Error('Expected a JSON array of objects.');
    const keys = [...new Set(arr.flatMap((o) => Object.keys(o)))];
    const table = [keys, ...arr.map((o) => keys.map((k) => (o[k] == null ? '' : String(o[k]))))];
    return tableToDataset(table, name, fileName);
  }
  return tableToDataset(parseCsv(text), name, fileName);
}

// ---------- describing ----------

export function describe(ds: Dataset, detail = false) {
  const cols = ds.columns.map((c) => {
    const base: Record<string, unknown> = { name: c.name, type: c.type };
    if (!detail) return base;
    const vals = ds.rows.map((r) => r[c.name]).filter((v) => v !== null);
    if (c.type === 'number') {
      const nums = vals as number[];
      base.min = Math.min(...nums);
      base.max = Math.max(...nums);
      base.total = round(nums.reduce((a, b) => a + b, 0));
    } else {
      const distinct = [...new Set(vals as string[])].sort();
      base.distinct_count = distinct.length;
      if (c.type === 'date') {
        base.min = distinct[0];
        base.max = distinct[distinct.length - 1];
      } else base.values = distinct.length <= 40 ? distinct : [...distinct.slice(0, 40), `…and ${distinct.length - 40} more`];
    }
    return base;
  });
  return { name: ds.name, rows: ds.rows.length, columns: cols, ...(detail ? { sample_rows: ds.rows.slice(0, 3) } : {}) };
}

// ---------- querying ----------

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'between';
export interface Filter {
  column: string;
  op: FilterOp;
  value: Cell | Cell[];
}
export type MetricFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';
export interface Metric {
  fn: MetricFn;
  column?: string;
  as?: string;
}
export interface Query {
  dataset: string;
  filters?: Filter[];
  group_by?: string[];
  metrics?: Metric[];
  columns?: string[];
  sort?: { by: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const lc = (v: Cell) => String(v ?? '').toLowerCase();

function cmp(a: Cell, b: Cell): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null) return -1;
  if (b === null) return 1;
  return String(a).localeCompare(String(b));
}

function match(v: Cell, f: Filter): boolean {
  const val = f.value;
  switch (f.op) {
    case 'eq':
      return lc(v) === lc(val as Cell);
    case 'neq':
      return lc(v) !== lc(val as Cell);
    case 'contains':
      return lc(v).includes(lc(val as Cell));
    case 'in':
      return (Array.isArray(val) ? val : [val]).some((x) => lc(x) === lc(v));
    case 'between': {
      const [lo, hi] = Array.isArray(val) ? val : [val, val];
      return cmp(v, lo) >= 0 && cmp(v, hi) <= 0;
    }
    case 'gt':
      return cmp(v, val as Cell) > 0;
    case 'gte':
      return cmp(v, val as Cell) >= 0;
    case 'lt':
      return cmp(v, val as Cell) < 0;
    case 'lte':
      return cmp(v, val as Cell) <= 0;
  }
}

export function findDataset(all: Dataset[], ref: string): Dataset {
  const r = ref.toLowerCase();
  const ds = all.find((d) => d.id === ref || d.name.toLowerCase() === r) ?? all.find((d) => d.name.toLowerCase().includes(r));
  if (!ds) throw new Error(`No dataset called "${ref}". Loaded: ${all.map((d) => d.name).join(', ') || 'none'}.`);
  return ds;
}

export function runQuery(all: Dataset[], q: Query) {
  const ds = findDataset(all, q.dataset);
  const known = new Set(ds.columns.map((c) => c.name));
  const need = [
    ...(q.filters ?? []).map((f) => f.column),
    ...(q.group_by ?? []),
    ...(q.metrics ?? []).map((m) => m.column).filter((c): c is string => !!c),
    ...(q.columns ?? []),
  ];
  const bad = need.filter((c) => !known.has(c));
  if (bad.length) throw new Error(`Unknown column(s) ${bad.join(', ')}. Columns are: ${[...known].join(', ')}.`);

  let rows = ds.rows.filter((r) => (q.filters ?? []).every((f) => match(r[f.column], f)));
  const matched = rows.length;
  let out: Row[];

  if ((q.group_by?.length ?? 0) > 0 || (q.metrics?.length ?? 0) > 0) {
    const gb = q.group_by ?? [];
    const metrics = q.metrics?.length ? q.metrics : [{ fn: 'count' as const }];
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = JSON.stringify(gb.map((g) => r[g]));
      let arr = groups.get(k);
      if (!arr) groups.set(k, (arr = []));
      arr.push(r);
    }
    out = [...groups.values()].map((g) => {
      const o: Row = {};
      gb.forEach((c) => (o[c] = g[0][c]));
      for (const m of metrics) {
        const key = m.as || (m.column ? `${m.fn}_${m.column}` : m.fn);
        const vals = m.column ? g.map((r) => r[m.column!]).filter((v) => v !== null) : g;
        const nums = (vals as Cell[]).filter((v): v is number => typeof v === 'number');
        switch (m.fn) {
          case 'count':
            o[key] = vals.length;
            break;
          case 'count_distinct':
            o[key] = new Set(vals as Cell[]).size;
            break;
          case 'sum':
            o[key] = round(nums.reduce((a, b) => a + b, 0));
            break;
          case 'avg':
            o[key] = nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
            break;
          case 'min':
            o[key] = nums.length ? Math.min(...nums) : null;
            break;
          case 'max':
            o[key] = nums.length ? Math.max(...nums) : null;
            break;
        }
      }
      return o;
    });
  } else {
    out = q.columns?.length ? rows.map((r) => Object.fromEntries(q.columns!.map((c) => [c, r[c]]))) : rows;
  }

  for (const s of [...(q.sort ?? [])].reverse()) {
    const dir = s.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => dir * cmp(a[s.by] ?? null, b[s.by] ?? null));
  }
  const limit = Math.min(Math.max(1, q.limit ?? 50), 500);
  rows = out.slice(0, limit);
  return { dataset: ds.name, matched_rows: matched, result_rows: out.length, rows, truncated: out.length > limit };
}
