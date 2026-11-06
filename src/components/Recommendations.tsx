import { AlertTriangle, ArrowDownCircle, ArrowLeftRight, CheckCircle2, ChevronDown, CircleHelp, PackageOpen, Square, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { Recommendation, ShelfSummary, TopSellerCheck } from '../lib/recommend';
import { STATUS_STYLE } from '../lib/settings';

/** The headline: which top sellers belong on this bay but aren't on it. */
export function TopSellerPanel({ check, onShowUnsure }: { check: TopSellerCheck; onShowUnsure: () => void }) {
  const [showPresent, setShowPresent] = useState(false);
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
  const definite = check.missing.filter((m) => !m.possible);
  const possible = check.missing.filter((m) => m.possible);
  const total = check.missing.length + check.present.length;
  const ok = check.missing.length === 0;
  const tone = definite.length ? 'bad' : possible.length ? 'warn' : 'good';
  const where = check.categories.length ? `${check.categories.join(' & ')} bay` : 'this shelf';

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
            {check.present.length} of {total} top sellers found on the {where}
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
        <ul className="ts-list">
          {definite.map((m) => (
            <li key={m.name}>
              <span className="ts-rank">#{m.categoryRank}</span>
              <span className="ts-name">
                {m.name}
                {m.category && <small>{m.category}</small>}
              </span>
              <span className="pill bad">Not on shelf</span>
            </li>
          ))}
        </ul>
      )}

      {possible.length > 0 && (
        <>
          <div className="ts-subhead">
            <CircleHelp size={14} /> Couldn't confirm. One of the amber boxes might be it
          </div>
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
              </li>
            ))}
          </ul>
        </>
      )}

      {check.present.length > 0 && (
        <>
          <button className="ts-toggle" onClick={() => setShowPresent((v) => !v)} aria-expanded={showPresent}>
            <CheckCircle2 size={16} /> {check.present.length} top seller{check.present.length > 1 ? 's' : ''} on shelf
            <ChevronDown size={16} className={showPresent ? 'rot' : ''} />
          </button>
          {showPresent && (
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
          )}
        </>
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
