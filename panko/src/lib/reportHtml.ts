/** Reports as HTML: the chart SVG used in the app, and a standalone file for download/print. */
import { mdToHtml } from '../components/Markdown';
import type { Report, ReportChart } from './store';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fmt(n: number, unit?: string): string {
  const v = Math.abs(n) >= 1000 ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (!unit) return v;
  return unit === '£' || unit === '$' || unit === '€' ? `${unit}${v}` : `${v} ${unit}`;
}

/** Single-series chart. Horizontal bars (long product names read well), or a line over time. */
export function chartSvg(c: ReportChart): string {
  const n = Math.min(c.labels.length, c.values.length);
  if (!n) return '';
  const labels = c.labels.slice(0, n);
  const values = c.values.slice(0, n).map((v) => Number(v) || 0);
  const max = Math.max(...values, 0) || 1;
  const min = Math.min(...values, 0);

  if (c.type === 'bar') {
    const rowH = 26;
    const labelW = 190;
    const W = 640;
    const plotW = W - labelW - 80;
    const H = n * rowH + 8;
    const bars = labels
      .map((l, i) => {
        const w = Math.max(2, (values[i] / max) * plotW);
        const y = i * rowH + 4;
        const short = l.length > 30 ? l.slice(0, 29) + '…' : l;
        return `<g class="mark"><title>${esc(l)}: ${esc(fmt(values[i], c.unit))}</title>
<rect x="0" y="${y - 2}" width="${W}" height="${rowH}" fill="transparent"/>
<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" class="lbl">${esc(short)}</text>
<path d="M${labelW},${y + 4} h${w - 4} a4,4 0 0 1 4,4 v6 a4,4 0 0 1 -4,4 h${-(w - 4)} z" class="bar"/>
<text x="${labelW + w + 6}" y="${y + 15}" class="val">${esc(fmt(values[i], c.unit))}</text></g>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title ?? 'Bar chart')}" class="chart">${bars}</svg>`;
  }

  // line
  const W = 640;
  const H = 240;
  const L = 56;
  const B = 28;
  const T = 12;
  const R = 16;
  const span = max - min || 1;
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B);
  const ticks = [min, min + span / 2, max];
  const grid = ticks
    .map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="axis">${esc(fmt(t, c.unit))}</text>`)
    .join('');
  const every = Math.ceil(n / 6);
  const xl = labels
    .map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(l.length > 12 ? l.slice(0, 11) + '…' : l)}</text>` : ''))
    .join('');
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const pts = values
    .map(
      (v, i) => `<g class="mark"><title>${esc(labels[i])}: ${esc(fmt(v, c.unit))}</title>
<rect x="${x(i) - (W - L - R) / Math.max(n - 1, 1) / 2}" y="${T}" width="${(W - L - R) / Math.max(n - 1, 1)}" height="${H - T - B}" fill="transparent"/>
<circle cx="${x(i)}" cy="${y(v)}" r="4" class="dot"/></g>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title ?? 'Line chart')}" class="chart">${grid}${xl}<path d="${path}" class="line"/>${pts}</svg>`;
}

export const REPORT_CSS = `
.report{--ink:#1d1b18;--ink-2:#5a554c;--ink-3:#8a8478;--rule:#e6e0d4;--surface:#fffdf8;--series-1:#2a78d6;color:var(--ink)}
.report h1{font-size:1.5rem;margin:0 0 .25rem}
.report .meta{color:var(--ink-3);font-size:.85rem;margin-bottom:1rem}
.report .summary{font-size:1.05rem;line-height:1.5;margin:0 0 1.25rem}
.report h2{font-size:1.1rem;margin:1.5rem 0 .5rem}
.report table{border-collapse:collapse;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums}
.report th,.report td{padding:.4rem .5rem;border-bottom:1px solid var(--rule);text-align:left}
.report th{color:var(--ink-2);font-weight:600}
.report td.n,.report th.n{text-align:right}
.report .chart{width:100%;height:auto;margin:.5rem 0;font:12px system-ui,sans-serif}
.report .chart .lbl{fill:var(--ink)}
.report .chart .val,.report .chart .axis{fill:var(--ink-2)}
.report .chart .bar{fill:var(--series-1)}
.report .chart .mark:hover .bar{opacity:.8}
.report .chart .grid{stroke:var(--rule);stroke-width:1}
.report .chart .line{fill:none;stroke:var(--series-1);stroke-width:2}
.report .chart .dot{fill:var(--series-1);stroke:var(--surface);stroke-width:2}
.report .chart-title{font-size:.85rem;color:var(--ink-2);margin:.5rem 0 0}
`;

export function sectionTableHtml(t: { columns: string[]; rows: (string | number | null)[][] }): string {
  const numeric = t.columns.map((_, i) => t.rows.length > 0 && t.rows.every((r) => r[i] === null || typeof r[i] === 'number'));
  const cell = (v: string | number | null) => (typeof v === 'number' ? fmt(v) : esc(v));
  return `<table><thead><tr>${t.columns.map((c, i) => `<th${numeric[i] ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows
    .map((r) => `<tr>${t.columns.map((_, i) => `<td${numeric[i] ? ' class="n"' : ''}>${cell(r[i] ?? null)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export function reportBodyHtml(r: Report): string {
  const date = new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return `<div class="report"><h1>${esc(r.title)}</h1><div class="meta">Panko report · ${esc(date)}</div>${
    r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''
  }${r.sections
    .map(
      (s) =>
        `<section><h2>${esc(s.heading)}</h2>${s.text ? mdToHtml(s.text) : ''}${
          s.chart ? `${s.chart.title ? `<p class="chart-title">${esc(s.chart.title)}</p>` : ''}${chartSvg(s.chart)}` : ''
        }${s.table ? sectionTableHtml(s.table) : ''}</section>`,
    )
    .join('')}</div>`;
}

export function reportDocument(r: Report): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title>
<style>body{font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;background:#fffdf8}${REPORT_CSS}@media print{body{margin:0}}</style></head><body>${reportBodyHtml(r)}</body></html>`;
}

export function downloadReport(r: Report) {
  const blob = new Blob([reportDocument(r)], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${r.title.replace(/[^\w -]+/g, '').trim() || 'report'}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function printReport(r: Report) {
  const w = window.open('', '_blank');
  if (!w) return downloadReport(r);
  w.document.write(reportDocument(r));
  w.document.close();
  setTimeout(() => w.print(), 300);
}
