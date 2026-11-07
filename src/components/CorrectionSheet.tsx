import { Check, PackageX, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_STYLE } from '../lib/settings';
import type { Facing } from '../lib/types';

interface Props {
  facing: Facing;
  crop: HTMLCanvasElement;
  products: string[];
  /** Shown before anything is typed: same brand / same bay category first. */
  suggestions?: string[];
  salesRank: (name: string) => number | undefined;
  onPick: (product: string) => void;
  onMarkGap: () => void;
  onClose: () => void;
}

/** Bottom sheet to confirm or correct what a box contains. */
export function CorrectionSheet({ facing, crop, products, salesRank, onPick, onMarkGap, onClose, suggestions }: Props) {
  const [q, setQ] = useState('');
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = imgRef.current;
    if (!host) return;
    host.innerHTML = '';
    crop.className = 'crop-preview';
    host.appendChild(crop);
  }, [crop]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t && suggestions?.length) return suggestions.slice(0, 40);
    const words = t.split(/\s+/).filter(Boolean);
    return products.filter((p) => words.every((w) => p.toLowerCase().includes(w))).slice(0, 50);
  }, [q, products, suggestions]);

  const st = STATUS_STYLE[facing.status];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Check product">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div ref={imgRef} className="crop-host" />
          <div className="sheet-info">
            <span className="badge" style={{ background: st.color }}>
              {st.label}
            </span>
            <h3>{facing.product ?? 'Unidentified product'}</h3>
            {facing.product && (
              <p className="muted">
                Match {(facing.confidence * 100).toFixed(0)}%
                {salesRank(facing.product) ? ` · Sales rank #${salesRank(facing.product)}` : ''}
                {facing.corrected ? ' · confirmed' : ''}
              </p>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {facing.product && !facing.corrected && (
          <button className="btn primary full" onClick={() => onPick(facing.product!)}>
            <Check size={18} /> Yes, this is {facing.product}
          </button>
        )}

        {facing.candidates.length > 1 && (
          <>
            <h4>Other likely matches</h4>
            <div className="cand-list">
              {facing.candidates.slice(1).map((c) => (
                <button key={c.product} className="btn" onClick={() => onPick(c.product)}>
                  {c.product} <span className="muted">{(c.score * 100).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          </>
        )}

        <h4>Pick the correct product</h4>
        <div className="search">
          <Search size={18} />
          <input
            className="input"
            placeholder={products.length ? `Search ${products.length} products…` : 'No catalogue loaded'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="pick-list">
          {filtered.map((p) => (
            <button key={p} className="pick-item" onClick={() => onPick(p)}>
              {p}
              {salesRank(p) ? <span className="muted"> #{salesRank(p)}</span> : null}
            </button>
          ))}
        </div>
        <button className="btn ghost full" onClick={onMarkGap}>
          <PackageX size={18} /> This is an empty space / not a product
        </button>
      </div>
    </div>
  );
}
