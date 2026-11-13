import { useEffect, useState } from 'react';
import { listScans, type HistoryMeta } from '../lib/history';

interface StoreScore {
  store: string;
  pct: number;
  present: number;
  total: number;
  bays: number;
  at: number;
  latestId: string;
}

const DAY = 864e5;

/**
 * Each store's latest top-seller score from this phone's scan history (last 30
 * days): all bays scanned on the most recent visit day, combined. Tap a store to
 * reopen its latest scan.
 */
export function storeScores(scans: HistoryMeta[], now = Date.now()): StoreScore[] {
  const byStore = new Map<string, HistoryMeta[]>();
  for (const s of scans) {
    if (!s.store || !s.total || s.planogramId || now - s.at > 30 * DAY) continue;
    byStore.set(s.store, [...(byStore.get(s.store) ?? []), s]);
  }
  const out: StoreScore[] = [];
  for (const [store, list] of byStore) {
    const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
    const day = new Date(latest.at).toDateString();
    const visit = list.filter((s) => new Date(s.at).toDateString() === day);
    const present = visit.reduce((n, s) => n + s.present, 0);
    const total = visit.reduce((n, s) => n + s.total, 0);
    out.push({ store, present, total, pct: Math.round((present / total) * 100), bays: visit.length, at: latest.at, latestId: latest.id });
  }
  return out.sort((a, b) => b.pct - a.pct || b.at - a.at);
}

function tone(pct: number) {
  return pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad';
}
const COLOUR = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' };

export function StoreLeague({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: number }) {
  const [rows, setRows] = useState<StoreScore[] | null>(null);

  useEffect(() => {
    listScans()
      .then((s) => setRows(storeScores(s)))
      .catch(() => setRows([]));
  }, [refreshKey]);

  if (!rows?.length) return null;
  const avg = Math.round(rows.reduce((n, r) => n + r.pct, 0) / rows.length);

  return (
    <section className="card league">
      <div className="league-head">
        <h3>Your stores</h3>
        <span className="muted small">Top sellers on shelf · average {avg}%</span>
      </div>
      {(
        <ul className="league-list">
          {rows.map((r) => {
            const t = tone(r.pct);
            return (
              <li key={r.store}>
                <button
                  className="league-row"
                  onClick={() => onOpen(r.latestId)}
                  aria-label={`${r.store}: ${r.pct}% of top sellers on shelf. Open latest scan`}
                >
                  <span className="league-name">
                    <b>{r.store}</b>
                    <small>
                      {new Date(r.at).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {r.present}/{r.total}
                      {r.bays > 1 ? ` · ${r.bays} bays` : ''}
                    </small>
                  </span>
                  <span className="league-bar" aria-hidden>
                    <div style={{ width: `${Math.max(4, r.pct)}%`, background: COLOUR[t] }} />
                  </span>
                  <span className={`pill ${t}`}>{r.pct}%</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
