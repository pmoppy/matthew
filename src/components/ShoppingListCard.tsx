import { Check, ListChecks, Share2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { shareList, type ShoppingList } from '../lib/shopping';

/** The rep's list of missing top sellers to order or pull from the stockroom. Shown on the home screen. */
export function ShoppingListCard({ list }: { list: ShoppingList }) {
  const [toast, setToast] = useState<string | null>(null);
  const open = list.items.filter((i) => !i.done).length;
  const done = list.items.length - open;

  if (!list.items.length) {
    return (
      <section className="card shop empty">
        <div className="shop-head">
          <span className="shop-icon">
            <ListChecks size={20} />
          </span>
          <div>
            <h3>Shopping list</h3>
            <p className="muted small">Missing top sellers you add after a scan will appear here.</p>
          </div>
        </div>
      </section>
    );
  }

  const share = async () => {
    const r = await shareList(list.items);
    if (r === 'copied') setToast('Copied to clipboard');
    else if (r === 'failed') setToast("Couldn't share the list");
    if (r !== 'shared') setTimeout(() => setToast(null), 2500);
  };

  return (
    <section className="card shop">
      <div className="shop-head">
        <span className="shop-icon">
          <ListChecks size={20} />
        </span>
        <div>
          <h3>Shopping list</h3>
          <p className="muted small">
            {open} to get{done ? ` · ${done} done` : ''}
          </p>
        </div>
        <button className="btn ghost icon-only" onClick={share} aria-label="Share list" title="Share list">
          <Share2 size={18} />
        </button>
      </div>
      <ul className="shop-list">
        {list.items.map((i) => (
          <li key={i.id} className={i.done ? 'done' : ''}>
            <button className="shop-check" onClick={() => list.toggle(i.id)} aria-label={i.done ? 'Mark as not done' : 'Mark as done'}>
              {i.done && <Check size={14} strokeWidth={3} />}
            </button>
            <span className="shop-name" onClick={() => list.toggle(i.id)}>
              {i.name}
              {i.category && <small>{i.category}</small>}
            </span>
            <button className="shop-remove" onClick={() => list.remove(i.name)} aria-label={`Remove ${i.name}`}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      <div className="row wrap">
        {done > 0 && (
          <button className="btn ghost" onClick={list.clearDone}>
            <Check size={16} /> Clear done
          </button>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            if (confirm('Clear the whole shopping list?')) list.clearAll();
          }}
        >
          <Trash2 size={16} /> Clear all
        </button>
      </div>
      {toast && <p className="muted small">{toast}</p>}
    </section>
  );
}
