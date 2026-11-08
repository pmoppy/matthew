import { Store } from 'lucide-react';
import { useState } from 'react';
import { STORES } from '../lib/stores';

const OTHER = '__other__';

/** Pick the store being visited from a list, or type another name. */
export function StorePicker({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const known = STORES.includes(value);
  const [typing, setTyping] = useState(!!value && !known);

  return (
    <div className={`store-picker ${compact ? 'compact' : ''}`}>
      <Store size={18} className="store-icon" />
      <div className="store-fields">
        {!compact && <span className="store-label">Store</span>}
        <select
          className="input store-select"
          value={typing ? OTHER : known ? value : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              setTyping(true);
              onChange('');
            } else {
              setTyping(false);
              onChange(v);
            }
          }}
          aria-label="Store"
        >
          <option value="">Select a store…</option>
          {STORES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={OTHER}>Other (type a name)…</option>
        </select>
        {typing && (
          <input className="input" placeholder="Store name" value={value} autoFocus onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </div>
  );
}
