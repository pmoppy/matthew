import { History, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clearScans, deleteScan, listScans, type HistoryMeta } from '../lib/history';

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function Thumb({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className="hist-thumb" src={url} alt="" />;
}

/** Recent scans on the home screen: tap to reopen, with photo, boxes and results. */
export function HistoryCard({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: number }) {
  const [items, setItems] = useState<HistoryMeta[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    listScans()
      .then(setItems)
      .catch(() => setItems([]));
  }, [refreshKey]);

  if (!items || items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, 4);

  return (
    <section className="card hist">
      <div className="shop-head">
        <span className="shop-icon">
          <History size={20} />
        </span>
        <div>
          <h3>Scan history</h3>
          <p className="muted small">
            {items.length} saved on this phone · tap to reopen
          </p>
        </div>
      </div>
      <ul className="hist-list">
        {shown.map((m) => (
          <li key={m.id}>
            <button className="hist-open" onClick={() => onOpen(m.id)}>
              <Thumb blob={m.thumb} />
              <span className="hist-text">
                <b>{m.store ? `${m.store} · ${m.bay}` : m.bay}</b>
                <small>
                  {when(m.at)} · {m.total ? `${m.present}/${m.total} top sellers` : `${m.facings} products`}
                  {m.photos && m.photos > 1 ? ` · ${m.photos} photos` : ''}
                </small>
              </span>
              {m.total > 0 && <span className={`pill ${m.missing ? 'bad' : 'good'}`}>{m.missing ? `${m.missing} missing` : 'All in'}</span>}
            </button>
            <button
              className="shop-remove"
              aria-label="Delete scan"
              onClick={async () => {
                await deleteScan(m.id);
                setItems((xs) => (xs ?? []).filter((x) => x.id !== m.id));
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <div className="row wrap">
        {items.length > 4 && (
          <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
        <button
          className="btn ghost"
          onClick={async () => {
            if (confirm('Delete all saved scans from this phone?')) {
              await clearScans();
              setItems([]);
            }
          }}
        >
          <Trash2 size={16} /> Clear history
        </button>
      </div>
    </section>
  );
}
