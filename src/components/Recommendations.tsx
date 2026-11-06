import type { Recommendation, ShelfSummary } from '../lib/recommend';
import { STATUS_STYLE } from '../lib/settings';

const ICON: Record<Recommendation['kind'], string> = {
  missing: '★',
  delist: '↓',
  facings: '⇄',
  gap: '▢',
  unsure: '?',
  info: 'i',
  good: '✓',
};

export function SummaryBar({ s }: { s: ShelfSummary }) {
  return (
    <div className="stats">
      <div className="stat">
        <b>{s.facings}</b>
        <span>facings</span>
      </div>
      <div className="stat">
        <b>{s.facings ? Math.round((s.identified / s.facings) * 100) : 0}%</b>
        <span>identified</span>
      </div>
      <div className="stat">
        <b>
          {s.topSellersPresent}/{s.topSellersTotal || '–'}
        </b>
        <span>top sellers</span>
      </div>
      <div className="stat">
        <b>{s.gaps}</b>
        <span>gaps</span>
      </div>
    </div>
  );
}

export function RecommendationList({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) return null;
  return (
    <div className="recs">
      {recs.map((r, i) => (
        <div key={i} className={`rec rec-${r.kind}`}>
          <div className="rec-icon">{ICON[r.kind]}</div>
          <div className="rec-body">
            <div className="rec-title">{r.title}</div>
            {r.detail && <div className="rec-detail">{r.detail}</div>}
            {r.items && (
              <ul>
                {r.items.map((it) => (
                  <li key={it.name}>
                    {it.name}
                    {it.note && <span className="muted"> · {it.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductTable({ s }: { s: ShelfSummary }) {
  if (!s.products.length) return null;
  return (
    <details className="card">
      <summary>Products on shelf ({s.products.length})</summary>
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
