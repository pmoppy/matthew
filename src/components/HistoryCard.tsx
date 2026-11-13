import { History, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CardHead, useOpen } from './CardHead';
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
export function HistoryCard({ onOpen, refreshKey, page = false }: { onOpen: (id: string) => void; refreshKey: number; page?: boolean }) {
  const [items, setItems] = useState<HistoryMeta[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expandedState, toggle] = useOpen('history');
  const expanded = page || expandedState;

  useEffect(() => {
    listScans()
      .then(setItems)
      .catch(() => setItems([]));
  }, [refreshKey]);

  if (!items || items.length === 0) return page ? <p className="muted">No scans saved on this phone yet.</p> : null;
  const shown = showAll || page ? items : items.slice(0, 4);

  return (
    <section className="card hist">
      {!page && (
      <CardHead
        icon={<History size={20} />}
        title="Scan history"
        open={expanded}
        onToggle={toggle}
        sub={`${items.length} saved on this phone · last ${when(items[0].at)}`}
      />
      )}
      {expanded && (
        <>
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
                      {m.planogramScore !== undefined ? ` · planogram ${Math.round(m.planogramScore * 100)}%` : ''}
                    </small>
                  </span>
                  {m.total > 0 && (
                    <span className={`pill ${m.missing ? 'bad' : 'good'}`}>{m.missing ? `${m.missing} missing` : 'All in'}</span>
                  )}
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
        </>
      )}
    </section>
  );
}
