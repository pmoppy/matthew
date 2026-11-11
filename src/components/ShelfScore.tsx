/** One top seller in the shelf icon: on the shelf, missing, or unclear. */
export interface ShelfSlot {
  rank: number;
  name: string;
  state: 'ok' | 'miss' | 'check';
}

/**
 * The bay's top sellers drawn as packs on a little shelf, best seller first
 * (top-left): solid green = on the shelf, dashed red gap = missing, amber =
 * to check. Up to 10 packs; more top sellers than that shows the top 10.
 */
export function ShelfScore({ slots }: { slots: ShelfSlot[] }) {
  const shown = slots.slice(0, 10);
  const n = shown.length;
  const shelves = n > 5 ? 2 : 1;
  const per = Math.ceil(n / shelves) || 1;
  const W = 104,
    inner = 86,
    gap = 3,
    packH = 30,
    rowH = 38;
  const w = Math.min(15, (inner - (per - 1) * gap) / per);
  const H = 12 + shelves * rowH;
  const label = shown
    .map((s) => `#${s.rank} ${s.name}: ${s.state === 'ok' ? 'on shelf' : s.state === 'miss' ? 'missing' : 'to check'}`)
    .join(', ');
  return (
    <svg className="shelf-score" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="12" style={{ fill: 'var(--surface-2)' }} />
      {Array.from({ length: shelves }, (_, r) => {
        const row = shown.slice(r * per, (r + 1) * per);
        const rowW = row.length * w + (row.length - 1) * gap;
        const x0 = (W - rowW) / 2;
        const y = 8 + r * rowH;
        return (
          <g key={r}>
            {row.map((s, i) => {
              const x = x0 + i * (w + gap);
              if (s.state === 'miss')
                return (
                  <rect
                    key={i}
                    x={x + 1}
                    y={y + 1}
                    width={w - 2}
                    height={packH - 2}
                    rx="3"
                    style={{ fill: 'none', stroke: 'var(--red)', strokeWidth: 2, strokeDasharray: '3 2' }}
                  />
                );
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={w}
                  height={packH}
                  rx="3"
                  style={{ fill: s.state === 'ok' ? 'var(--green)' : 'var(--amber)' }}
                />
              );
            })}
            <rect x="8" y={y + packH + 1} width={W - 16} height="4" rx="2" style={{ fill: 'var(--brand)' }} />
          </g>
        );
      })}
    </svg>
  );
}
