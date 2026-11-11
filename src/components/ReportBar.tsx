import { FileText, Loader2, MessageSquareText } from 'lucide-react';
import { StorePicker } from './StorePicker';
import { useState } from 'react';
import type { TopSellerCheck } from '../lib/recommend';
import { shareReportPdf } from '../lib/report';
import { shareText } from '../lib/shopping';
import type { Facing } from '../lib/types';
import { track } from '../lib/usage';

interface Props {
  check: TopSellerCheck;
  slow: { name: string; facings: number }[];
  shots: { image: HTMLCanvasElement; facings: Facing[] }[];
  productsFound: number;
  takenAt: number;
  store: string;
  onStoreChange: (v: string) => void;
}

/** Visit report: optional store name, then share as PDF or as a quick text message. */
export function ReportBar({ check, slow, shots, productsFound, takenAt, store, onStoreChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pdf = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await shareReportPdf({ store: store.trim() || undefined, takenAt, check, slow, shots, productsFound });
      track('pdf_report', store.trim() || undefined);
      if (r === 'downloaded') setMsg('Report downloaded');
    } catch (e) {
      console.error(e);
      setMsg(`Couldn't create the report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const text = () => {
    const total = check.present.length + check.missing.length;
    const definite = check.missing.filter((m) => !m.possible);
    const possible = check.missing.filter((m) => m.possible);
    const where = check.categories.length ? `the ${check.categories.join(' & ')} bay` : 'this shelf';
    const when = new Date(takenAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const lines = [`ShelfScan check${store.trim() ? ` · ${store.trim()}` : ''} · ${when}`, `${check.present.length}/${total} top sellers on ${where}`];
    if (definite.length) lines.push('', 'Missing:', ...definite.map((m) => `• ${m.name}`));
    if (possible.length) lines.push('', 'To check:', ...possible.map((m) => `• ${m.name}`));
    if (slow.length) lines.push('', 'Slow sellers to swap out:', ...slow.map((m) => `• ${m.name} (${m.facings})`));
    if (check.present.length) lines.push('', 'On shelf:', ...check.present.map((m) => `• ${m.name} (${m.facings})`));
    shareText('Shelf report', lines.join('\n'));
  };

  return (
    <section className="card report-bar">
      <StorePicker value={store} onChange={onStoreChange} compact />
      <div className="report-actions">
        <button className="btn primary" onClick={pdf} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />} PDF report
        </button>
        <button className="btn" onClick={text} disabled={busy}>
          <MessageSquareText size={16} /> Text summary
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}
