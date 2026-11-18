// Builds public/demo/sales.csv: 12 weeks of made-up store sales for the
// ShelfScan starter product list, so Panko has something to talk about on day one.
// Deterministic (seeded), so re-running gives the same file.
import { readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../../public/starter/file/sales.csv', import.meta.url);
const out = new URL('../public/demo/sales.csv', import.meta.url);

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const lines = readFileSync(src, 'utf8').trim().split(/\r?\n/).slice(1);
const products = lines.map((l) => {
  const [product, rank, category] = l.split(',');
  return { product, rank: Number(rank), category };
});

const catBase = { Energy: 60, Sports: 35, Cola: 70, Flavoured: 40, Crisps: 45, Confectionery: 40, Water: 30 };
const priceFor = (name, cat) => {
  const m = name.match(/(\d+)\s*ml/i);
  if (cat === 'Energy') return m && Number(m[1]) >= 500 ? 1.89 : 1.49;
  if (['Cola', 'Flavoured', 'Sports', 'Water'].includes(cat)) return m && Number(m[1]) >= 500 ? 1.55 : 1.0;
  if (/150g|140g|100g|105g|90g/.test(name)) return 2.25;
  return 1.0;
};
const stores = [
  { store: 'Leeds Central', size: 1.35 },
  { store: 'York Station', size: 1.1 },
  { store: 'Harrogate', size: 0.8 },
  { store: 'Wakefield', size: 0.95 },
];
const start = new Date('2026-08-03T00:00:00Z'); // Monday
const rows = ['week_start,store,product,category,units,price,revenue'];
for (let w = 0; w < 12; w++) {
  const d = new Date(start.getTime() + w * 7 * 864e5).toISOString().slice(0, 10);
  const season = 1 + 0.12 * Math.sin((w / 12) * Math.PI); // a little late-summer bump
  for (const s of stores) {
    for (const p of products) {
      const base = (catBase[p.category] ?? 30) * Math.pow(0.86, p.rank - 1);
      const trend = p.product.includes('Pistachio') ? 0.4 + w * 0.12 : 1; // a new line ramping up
      const units = Math.max(0, Math.round(base * s.size * season * trend * (0.8 + rnd() * 0.4)));
      const price = priceFor(p.product, p.category);
      const name = p.product.includes(',') ? `"${p.product}"` : p.product;
      rows.push([d, s.store, name, p.category, units, price.toFixed(2), (units * price).toFixed(2)].join(','));
    }
  }
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(`Wrote ${rows.length - 1} rows for ${products.length} products`);
