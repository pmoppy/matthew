import { AlertTriangle, ArrowDownCircle, ArrowLeftRight, Check, CheckCircle2, ChevronDown, CircleHelp, ListPlus, PackageOpen, Plus, Square, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { Recommendation, ShelfSummary, TopSellerCheck, TopSellerItem } from '../lib/recommend';
import type { ShoppingList } from '../lib/shopping';
import { STATUS_STYLE } from '../lib/settings';

/** The headline: which top sellers belong on this bay but aren't on it. */
function ListButton({ item, list }: { item: TopSellerItem; list: ShoppingList }) {
  const added = list.has(item.name);
  return (
    <button
      className={`list-btn ${added ? 'added' : ''}`}
      onClick={() => (added ? list.remove(item.name) : list.add([{ name: item.name, category: item.category, rank: item.categoryRank }]))}
      aria-label={added ? `Remove ${item.name} from shopping list` : `Add ${item.name} to shopping list`}
    >
      {added ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
      {added ? 'On list' : 'List'}
    </button>
  );
}

/** Collapsible group in the result: a one-line summary that expands to the products. */
export function Section({ tone, icon, label, preview, children }: { tone: 'bad' | 'warn' | 'good' | 'slow'; icon: React.ReactNode; label: string; preview: string[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const short = preview.slice(0, 2).join(', ') + (preview.length > 2 ? ` +${preview.length - 2} more` : '');
  return (
    <div className="ts-section">
      <button className={`ts-toggle ${tone}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {icon}
        <span className="ts-toggle-text">
          <b>{label}</b>
          {!open && <small>{short}</small>}
        </span>
        <ChevronDown size={16} className={open ? 'rot' : ''} />
      </button>
      {open && children}
    </div>
  );
}

export function TopSellerPanel({
  check,
  onShowUnsure,
  list,
  slow = [],
  onShowSlow,
}: {
  check: TopSellerCheck;
  onShowUnsure: () => void;
  list: ShoppingList;
  /** Slow sellers (bottom of the ranking) taking up space on this bay. */
  slow?: { name: string; facings: number }[];
  onShowSlow?: () => void;
}) {
  if (!check.hasSales) {
    return (
      <section className="ts-panel neutral">
        <div className="ts-head">
          <div className="ts-icon">
            <Trophy size={22} />
          </div>
          <div>
            <div className="ts-title">Top-seller list unavailable</div>
            <div className="ts-sub">The product library has no sales ranking yet, so missing top sellers can't be checked.</div>
          </div>
        </div>
      </section>
    );
  }
  if (!check.bayKnown) {
    return (
      <section className="ts-panel warn">
        <div className="ts-head">
          <div className="ts-icon">
            <CircleHelp size={22} />
          </div>
          <div>
            <div className="ts-title">Couldn't check this bay</div>
            <div className="ts-sub">
              Too few products were recognised to tell which top sellers belong here. Retake the photo straight-on and closer, avoiding glare
              from the fridge door, or tap the amber boxes to confirm products.
            </div>
          </div>
        </div>
      </section>
    );
  }
  if (check.missing.length + check.present.length === 0) {
    const cats = check.categories.join(' & ') || 'this bay';
    return (
      <section className="ts-panel neutral">
        <div className="ts-head">
          <div className="ts-icon">
            <Trophy size={22} />
          </div>
          <div>
            <div className="ts-title">No top-seller list for {cats} yet</div>
            <div className="ts-sub">Products are still identified below. Add {cats} lines to the sales ranking to check this bay for missing top sellers.</div>
          </div>
        </div>
      </section>
    );
  }
  const definite = check.missing.filter((m) => !m.possible);
  const possible = check.missing.filter((m) => m.possible);
  const total = check.missing.length + check.present.length;
  const ok = check.missing.length === 0;
  const tone = definite.length ? 'bad' : possible.length ? 'warn' : 'good';
  const where = check.categories.length ? `the ${check.categories.join(' & ')} bay` : 'this shelf';


  return (
    <section className={`ts-panel ${tone}`}>
      <div className="ts-head">
        <div className="ts-icon">{ok ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</div>
        <div>
          <div className="ts-title">
            {ok
              ? 'All top sellers are on the shelf'
              : definite.length
                ? `${definite.length} top seller${definite.length > 1 ? 's' : ''} missing`
                : `${possible.length} top seller${possible.length > 1 ? 's' : ''} to check`}
          </div>
          <div className="ts-sub">
            {check.present.length} of {total} top sellers found on {where}
          </div>
        </div>
        <div className="ts-score">
          <b>{check.present.length}</b>/{total}
        </div>
      </div>

      {total > 0 && (
        <div className="ts-meter" aria-hidden>
          <div style={{ width: `${(check.present.length / total) * 100}%` }} />
        </div>
      )}

      {definite.length > 0 && (
        <button
          className="btn add-all"
          disabled={definite.every((m) => list.has(m.name))}
          onClick={() => list.add(definite.map((m) => ({ name: m.name, category: m.category, rank: m.categoryRank })))}
        >
          <ListPlus size={18} />
          {definite.every((m) => list.has(m.name)) ? 'All on your shopping list' : `Add ${definite.length > 1 ? `all ${definite.length}` : 'it'} to shopping list`}
        </button>
      )}

      {definite.length > 0 && (
        <Section tone="bad" icon={<AlertTriangle size={16} />} label={`${definite.length} missing`} preview={definite.map((m) => m.name)}>
          <ul className="ts-list">
            {definite.map((m) => (
              <li key={m.name}>
                <span className="ts-rank">#{m.categoryRank}</span>
                <span className="ts-name">
                  {m.name}
                  {m.category && <small>{m.category}</small>}
                </span>
                <ListButton item={m} list={list} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {possible.length > 0 && (
        <Section tone="warn" icon={<CircleHelp size={16} />} label={`${possible.length} to check`} preview={possible.map((m) => m.name)}>
          <div className="ts-subhead">Couldn't confirm. One of the amber boxes might be it</div>
          <ul className="ts-list">
            {possible.map((m) => (
              <li key={m.name}>
                <span className="ts-rank">#{m.categoryRank}</span>
                <span className="ts-name">
                  {m.name}
                  {m.category && <small>{m.category}</small>}
                </span>
                <button className="pill warn" onClick={onShowUnsure}>
                  Check
                </button>
                <ListButton item={m} list={list} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {slow.length > 0 && (
        <Section
          tone="slow"
          icon={<ArrowDownCircle size={16} />}
          label={`${slow.length} slow seller${slow.length > 1 ? 's' : ''} on shelf`}
          preview={slow.map((m) => m.name)}
        >
          <div className="ts-subhead slow">Bottom of the sales ranking. Swap these facings for the missing top sellers.</div>
          <ul className="ts-list">
            {slow.map((m) => (
              <li key={m.name}>
                <span className="ts-name">{m.name}</span>
                <span className="pill bad">
                  {m.facings} facing{m.facings > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          {onShowSlow && (
            <button className="btn ghost full" onClick={onShowSlow}>
              Show them on the photo
            </button>
          )}
        </Section>
      )}

      {check.present.length > 0 && (
        <Section tone="good" icon={<CheckCircle2 size={16} />} label={`${check.present.length} on shelf`} preview={check.present.map((m) => m.name)}>
          <ul className="ts-list present">
            {check.present.map((m) => (
              <li key={m.name}>
                <span className="ts-rank">#{m.categoryRank}</span>
                <span className="ts-name">{m.name}</span>
                <span className="pill good">
                  {m.facings} facing{m.facings > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </section>
  );
}

const ICON: Record<Recommendation['kind'], typeof ArrowDownCircle> = {
  delist: ArrowDownCircle,
  facings: ArrowLeftRight,
  gap: Square,
  unsure: CircleHelp,
  info: PackageOpen,
};

export function RecommendationList({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) return null;
  return (
    <section className="recs">
      <h2 className="section-title">More ways to improve this bay</h2>
      {recs.map((r, i) => {
        const Icon = ICON[r.kind];
        return (
          <div key={i} className={`rec rec-${r.kind}`}>
            <div className="rec-icon">
              <Icon size={18} />
            </div>
            <div className="rec-body">
              <div className="rec-title">{r.title}</div>
              {r.detail && <div className="rec-detail">{r.detail}</div>}
              {r.items && (
                <ul className="rec-items">
                  {r.items.map((it) => (
                    <li key={it.name}>
                      <span>{it.name}</span>
                      {it.note && <span className="rec-note">{it.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function ProductTable({ s }: { s: ShelfSummary }) {
  if (!s.products.length) return null;
  return (
    <details className="card table-card">
      <summary>
        Everything identified <span className="chip-count">{s.products.length}</span>
      </summary>
      <table className="ptable">
        <thead>
          <tr>
            <th>Product</th>
            <th>Rank</th>
            <th>Facings</th>
          </tr>
        </thead>
        <tbody>
          {s.products.map((p) => (
            <tr key={p.name}>
              <td>
                <span className="dot" style={{ background: STATUS_STYLE[p.status]?.color }} />
                {p.name}
              </td>
              <td>{p.rank ? `#${p.rank}` : '–'}</td>
              <td>{p.facings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
