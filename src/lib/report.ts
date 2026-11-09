import { Capacitor } from '@capacitor/core';
import { STATUS_STYLE } from './settings';
import type { TopSellerCheck } from './recommend';
import type { Facing } from './types';

export interface ReportInput {
  store?: string;
  takenAt: number;
  check: TopSellerCheck;
  slow: { name: string; facings: number }[];
  shots: { image: HTMLCanvasElement; facings: Facing[] }[];
  productsFound: number;
}

/** Shelf photo with the coloured boxes drawn on, as a JPEG data URL for the PDF. */
function annotated(image: HTMLCanvasElement, facings: Facing[], maxSide = 1400): { url: string; w: number; h: number } {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const c = document.createElement('canvas');
  c.width = Math.round(image.width * scale);
  c.height = Math.round(image.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const lw = Math.max(2, Math.round(c.width / 320));
  for (const f of facings) {
    // Highlight what matters in a report: top sellers, slow sellers, empty spaces.
    if (f.status !== 'top' && f.status !== 'delist' && f.status !== 'gap') continue;
    const st = STATUS_STYLE[f.status];
    const x = f.x1 * scale, y = f.y1 * scale, w = (f.x2 - f.x1) * scale, h = (f.y2 - f.y1) * scale;
    ctx.lineWidth = lw + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = lw;
    ctx.strokeStyle = st.color;
    ctx.setLineDash(st.dash ? [lw * 3, lw * 2] : []);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  return { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}

const NAVY: [number, number, number] = [38, 55, 79];
const INK: [number, number, number] = [31, 38, 51];
const MUTED: [number, number, number] = [125, 127, 134];
const RED: [number, number, number] = [176, 67, 47];
const AMBER: [number, number, number] = [168, 115, 29];
const GREEN: [number, number, number] = [59, 122, 85];
const LINEN: [number, number, number] = [243, 239, 231];

export async function buildReportPdf(r: ReportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16;
  let y = 0;

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text('ShelfScan visit report', M, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const when = new Date(r.takenAt).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  doc.text([r.store ? `${r.store}  ·  ${when}` : when], M, 23);
  y = 40;

  // Score
  const total = r.check.present.length + r.check.missing.length;
  const definite = r.check.missing.filter((m) => !m.possible);
  const possible = r.check.missing.filter((m) => m.possible);
  const bay = r.check.categories.length ? `${r.check.categories.join(' & ')} bay` : 'Shelf';
  doc.setTextColor(...INK);
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text(bay, M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`${r.productsFound} products found${r.shots.length > 1 ? ` across ${r.shots.length} photos` : ''}`, M, y + 6);

  // Score tiles
  const tiles: [string, string, [number, number, number]][] = [
    [total ? `${r.check.present.length}/${total}` : '–', 'top sellers on shelf', GREEN],
    [String(definite.length), 'top sellers missing', RED],
    [String(r.slow.length), 'slow sellers on shelf', AMBER],
  ];
  y += 12;
  const tw = (W - 2 * M - 8) / 3;
  tiles.forEach(([big, label, col], i) => {
    const x = M + i * (tw + 4);
    doc.setFillColor(...LINEN);
    doc.roundedRect(x, y, tw, 20, 3, 3, 'F');
    doc.setTextColor(...col);
    doc.setFont('times', 'bold');
    doc.setFontSize(18);
    doc.text(big, x + 5, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 5, y + 16);
  });
  y += 28;

  const section = (title: string, col: [number, number, number], rows: string[]) => {
    if (!rows.length) return;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setTextColor(...col);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, M, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    for (const row of rows) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(row, M + 3, y);
      y += 5.5;
    }
    y += 4;
  };
  section('Missing top sellers: add these', RED, definite.map((m) => `☐  #${m.categoryRank}  ${m.name}`.replace('☐', '-')));
  section('To check (an unclear product might be one of these)', AMBER, possible.map((m) => `-  #${m.categoryRank}  ${m.name}`));
  section('Slow sellers on shelf: swap for missing top sellers', AMBER, r.slow.map((m) => `-  ${m.name}  (${m.facings} facing${m.facings > 1 ? 's' : ''})`));
  section('Top sellers on shelf', GREEN, r.check.present.map((m) => `-  #${m.categoryRank}  ${m.name}  (${m.facings} facing${m.facings > 1 ? 's' : ''})`));

  // Photos, one per page
  for (let i = 0; i < r.shots.length; i++) {
    doc.addPage();
    const img = annotated(r.shots[i].image, r.shots[i].facings);
    doc.setTextColor(...INK);
    doc.setFont('times', 'bold');
    doc.setFontSize(14);
    doc.text(r.shots.length > 1 ? `Shelf photo ${i + 1} of ${r.shots.length}` : 'Shelf photo', M, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('Green = top seller   Red = slow seller   Purple dashed = empty space', M, 24);
    const maxW = W - 2 * M, maxH = 297 - 32 - 14;
    const k = Math.min(maxW / img.w, maxH / img.h);
    doc.addImage(img.url, 'JPEG', M + (maxW - img.w * k) / 2, 30, img.w * k, img.h * k);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`ShelfScan · page ${p} of ${pages}`, M, 290);
  }
  return doc.output('blob');
}

function fileName(r: ReportInput) {
  const d = new Date(r.takenAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const store = r.store ? `-${r.store.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
  return `ShelfScan-report${store}-${stamp}.pdf`;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Create the PDF and open the share sheet (APK / mobile web) or download it (desktop). */
export async function shareReportPdf(r: ReportInput): Promise<'shared' | 'downloaded'> {
  const blob = await buildReportPdf(r);
  const name = fileName(r);
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: 'ShelfScan visit report', files: [saved.uri], dialogTitle: 'Share visit report' });
    return 'shared';
  }
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'ShelfScan visit report' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

/** Share a text file (e.g. CSV) through the share sheet on Android, or download it on the web. */
export async function shareFile(name: string, text: string, mime: string): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([text], { type: mime });
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, files: [saved.uri], dialogTitle: 'Share export' });
    return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

/** Share any binary file (e.g. ZIP) through the share sheet on Android, or download it on the web. */
export async function shareBlob(name: string, blob: Blob): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: name, files: [saved.uri], dialogTitle: 'Share export' });
    return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
