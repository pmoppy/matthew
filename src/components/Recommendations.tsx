import { ArrowDownCircle, ArrowLeftRight, CheckCircle2, HelpCircle, Info, Layers, PackageOpen, Percent, Square, Star, Trophy } from 'lucide-react';
import type { Recommendation, ShelfSummary } from '../lib/recommend';
import { STATUS_STYLE } from '../lib/settings';

const ICON: Record<Recommendation['kind'], typeof Star> = {
  missing: Star,
  delist: ArrowDownCircle,
  facings: ArrowLeftRight,
  gap: Square,
  unsure: HelpCircle,
  info: Info,
  good: CheckCircle2,
};

export function SummaryBar({ s }: { s: ShelfSummary }) {
  const pct = s.facings ? Math.round((s.identified / s.facings) * 100) : 0;
  const tiles = [
    { Icon: Layers, value: s.facings, label: 'Facings', tone: 'blue' },
    { Icon: Percent, value: `${pct}%`, label: 'Identified', tone: 'violet' },
    { Icon: Trophy, value: `${s.topSellersPresent}/${s.topSellersTotal || '–'}`, label: 'Top sellers', tone: 'green' },
    { Icon: PackageOpen, value: s.gaps, label: 'Gaps', tone: 'purple' },
  ];
  return (
    <div className="stats">
      {tiles.map(({ Icon, value, label, tone }) => (
        <div key={label} className={`stat tone-${tone}`}>
          <span className="stat-icon">
            <Icon size={16} />
          </span>
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function RecommendationList({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) return null;
  return (
    <section className="recs">
      <h2 className="section-title">Recommendations</h2>
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
        Products on shelf <span className="chip-count">{s.products.length}</span>
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
