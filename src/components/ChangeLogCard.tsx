import { ArrowRight, ClipboardList, Download, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clearChanges, exportChangesZip, listChanges, type ChangeEntry } from '../lib/changelog';
import { shareBlob } from '../lib/report';

function Crop({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className="chg-crop" src={url} alt="" />;
}

const LABEL: Record<ChangeEntry['action'], string> = { confirmed: 'Confirmed', corrected: 'Corrected', marked_empty: 'Marked empty' };

/** Admin: every confirmation / correction made by reps on this phone, with the pack photo. */
export function ChangeLogCard() {
  const [items, setItems] = useState<ChangeEntry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listChanges()
      .then(setItems)
      .catch(() => {});
  }, []);

  const corrected = items.filter((c) => c.action !== 'confirmed').length;
  const shown = showAll ? items : items.slice(0, 8);

  const exportZip = async () => {
    setMsg(null);
    try {
      const r = await exportChangesZip();
      if (!r) return;
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const how = await shareBlob(`ShelfScan-rep-changes-${stamp}.zip`, r.zip);
      setMsg(`${how === 'shared' ? 'Exported' : 'Downloaded'} ${r.count} changes (CSV + photos).`);
    } catch (e) {
      setMsg(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="card">
      <h2>
        <ClipboardList size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Rep changes (audit log)
      </h2>
      <p className="muted small">
        Every time a rep confirms or corrects a product, or marks a box as empty, it's recorded here with what the app said, what the rep
        chose, the store, time and the photo of the pack. Export gives <code>rep-changes.csv</code> plus the photos.
      </p>
      <p>
        <b>{items.length}</b> change{items.length === 1 ? '' : 's'} on this phone · {corrected} correction{corrected === 1 ? '' : 's'} ·{' '}
        {items.length - corrected} confirmation{items.length - corrected === 1 ? '' : 's'}
      </p>
      {items.length > 0 && (
        <ul className="chg-list">
          {shown.map((c) => (
            <li key={c.id}>
              <Crop blob={c.crop} />
              <div className="chg-body">
                <div className="chg-what">
                  <span className={`chg-from ${c.action === 'confirmed' ? 'same' : ''}`}>{c.appProduct ?? 'Not identified'}</span>
                  {c.action !== 'confirmed' && (
                    <>
                      <ArrowRight size={14} />
                      <b>{c.repProduct ?? 'Empty space'}</b>
                    </>
                  )}
                </div>
                <small>
                  <span className={`pill ${c.action === 'corrected' ? 'bad' : c.action === 'confirmed' ? 'good' : 'warn'}`}>{LABEL[c.action]}</span>{' '}
                  {new Date(c.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  {c.store ? ` · ${c.store}` : ''}
                  {c.appConfidence ? ` · app ${Math.round(c.appConfidence * 100)}%` : ''}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        {items.length > 8 && (
          <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
        <button className="btn" onClick={exportZip} disabled={!items.length}>
          <Download size={18} /> Export (CSV + photos)
        </button>
        <button
          className="btn ghost"
          disabled={!items.length}
          onClick={async () => {
            if (confirm('Delete the rep change log from this phone? Export it first if you need it.')) {
              await clearChanges();
              setItems([]);
            }
          }}
        >
          <Trash2 size={18} /> Clear
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
