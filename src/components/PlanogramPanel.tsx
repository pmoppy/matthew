import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  CircleHelp,
  ImageUp,
  LayoutGrid,
  ListPlus,
  PackagePlus,
  PackageX,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cachedMedia, fetchMedia } from '../lib/media';
import { planogramsFrom, shelfLabel, type Planogram, type PlanogramResult } from '../lib/planogram';
import type { ShoppingList } from '../lib/shopping';
import { Viewer } from './MediaHub';
import { Section } from './Recommendations';

/** Planograms published in the media hub that the app can check a bay against. */
export function usePlanograms(libraryBase: string): Planogram[] {
  const [items, setItems] = useState(() => planogramsFrom(cachedMedia()));
  useEffect(() => {
    let live = true;
    fetchMedia(libraryBase).then((xs) => live && setItems(planogramsFrom(xs)));
    return () => {
      live = false;
    };
  }, [libraryBase]);
  return items;
}

/** Bottom sheet: pick a planogram, then take or upload the bay photo. */
export function PlanogramPicker({
  planograms,
  onClose,
  onPick,
}: {
  planograms: Planogram[];
  onClose: () => void;
  onPick: (p: Planogram, source: 'camera' | 'upload') => void;
}) {
  const [chosen, setChosen] = useState<Planogram | null>(planograms.length === 1 ? planograms[0] : null);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Check against a planogram" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="pog-sheet-head">
          <h3>Check against a planogram</h3>
          <button className="btn ghost icon-only" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {!planograms.length ? (
          <p className="muted">No planograms have been published yet. They appear here when one is added to the media hub.</p>
        ) : (
          <>
            <p className="muted small">1. Choose the planogram for this bay</p>
            <ul className="pog-choices">
              {planograms.map((p) => (
                <li key={p.id}>
                  <button className={`pog-choice ${chosen?.id === p.id ? 'on' : ''}`} onClick={() => setChosen(p)}>
                    {p.item.thumbUrl ? <img src={p.item.thumbUrl} alt="" /> : <LayoutGrid size={22} />}
                    <span>
                      <b>{p.title}</b>
                      <small>
                        {p.lines.length} products · {p.lines.reduce((n, l) => n + l.facings, 0)} facings
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">2. Photograph the whole bay</p>
            <div className="row">
              <button className="btn primary grow" disabled={!chosen} onClick={() => chosen && onPick(chosen, 'camera')}>
                <Camera size={18} /> Take photo
              </button>
              <button className="btn grow" disabled={!chosen} onClick={() => chosen && onPick(chosen, 'upload')}>
                <ImageUp size={18} /> Upload
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function facingsText(n: number) {
  return `${n} facing${n === 1 ? '' : 's'}`;
}

/** Result of a planogram check, shown above the top-seller panel. */
export function PlanogramPanel({
  pog,
  r,
  list,
  onShowUnsure,
  onShow,
  closeRef,
}: {
  pog: Planogram;
  r: PlanogramResult;
  list: ShoppingList;
  onShowUnsure: () => void;
  /** Show only one kind of box on the photo. */
  onShow?: (s: 'pog_ok' | 'pog_short' | 'pog_off') => void;
  closeRef?: React.MutableRefObject<(() => boolean) | null>;
}) {
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = viewing
      ? () => {
          setViewing(false);
          return true;
        }
      : null;
  });

  const pct = Math.round(r.score * 100);
  const tone = !r.expected ? 'neutral' : pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad';
  const toAdd = r.missing.map((m) => m.product);
  const allListed = toAdd.every((n) => list.has(n));

  return (
    <section className={`ts-panel pog-panel ${tone}`}>
      <div className="ts-head">
        <div className="ts-icon">
          <LayoutGrid size={22} />
        </div>
        <div>
          <div className="ts-title">{r.expected ? `Planogram ${pct}% in place` : "Can't check this planogram yet"}</div>
          <div className="ts-sub">
            {r.expected
              ? `${r.placed} of ${r.expected} facings match ${pog.title}`
              : 'None of its products are in the product library yet.'}
          </div>
        </div>
        {r.expected > 0 && (
          <div className="ts-score">
            <b>{pct}</b>%
          </div>
        )}
      </div>
      {r.expected > 0 && (
        <div className="ts-meter" aria-hidden>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="row wrap">
        <button className="btn grow" onClick={() => setViewing(true)}>
          <LayoutGrid size={18} /> View planogram
        </button>
        {toAdd.length > 0 && (
          <button className="btn grow" disabled={allListed} onClick={() => list.add(r.missing.map((m) => ({ name: m.product })))}>
            <ListPlus size={18} /> {allListed ? 'On shopping list' : `Add ${toAdd.length} missing to list`}
          </button>
        )}
      </div>

      {r.missing.length > 0 && (
        <Section
          tone="bad"
          icon={<AlertTriangle size={16} />}
          label={`${r.missing.length} missing`}
          preview={r.missing.map((m) => m.product)}
        >
          <ul className="ts-list">
            {r.missing.map((m) => (
              <li key={m.product}>
                <span className="ts-name">
                  {m.product}
                  <small>
                    {shelfLabel(m.shelves)} · {facingsText(m.expected)} expected
                  </small>
                </span>
                <span className="pill bad">0/{m.expected}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.short.length > 0 && (
        <Section
          tone="warn"
          icon={<ArrowLeftRight size={16} />}
          label={`${r.short.length} short on facings`}
          preview={r.short.map((m) => m.product)}
        >
          <ul className="ts-list">
            {r.short.map((m) => (
              <li key={m.product}>
                <span className="ts-name">
                  {m.product}
                  <small>
                    {shelfLabel(m.shelves)} · needs {m.expected - m.found} more
                  </small>
                </span>
                <span className="pill warn">
                  {m.found}/{m.expected}
                </span>
              </li>
            ))}
          </ul>
          {onShow && (
            <button className="btn ghost full" onClick={() => onShow('pog_short')}>
              Show them on the photo (blue)
            </button>
          )}
        </Section>
      )}

      {r.toCheck.length > 0 && (
        <Section
          tone="warn"
          icon={<CircleHelp size={16} />}
          label={`${r.toCheck.length} to check`}
          preview={r.toCheck.map((m) => m.product)}
        >
          <div className="ts-subhead">Couldn't confirm. One of the amber boxes might be it</div>
          <ul className="ts-list">
            {r.toCheck.map((m) => (
              <li key={m.product}>
                <span className="ts-name">
                  {m.product}
                  <small>
                    {shelfLabel(m.shelves)} · {facingsText(m.expected)} expected
                  </small>
                </span>
                <button className="pill warn" onClick={onShowUnsure}>
                  Check
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.extra.length > 0 && (
        <Section
          tone="slow"
          icon={<PackagePlus size={16} />}
          label={`${r.extra.length} not on the planogram`}
          preview={r.extra.map((m) => m.product)}
        >
          <div className="ts-subhead slow">On the shelf but not in this planogram. These facings could go to missing lines.</div>
          <ul className="ts-list">
            {r.extra.map((m) => (
              <li key={m.product}>
                <span className="ts-name">{m.product}</span>
                <span className="pill bad">{facingsText(m.found)}</span>
              </li>
            ))}
          </ul>
          {onShow && (
            <button className="btn ghost full" onClick={() => onShow('pog_off')}>
              Show them on the photo (red)
            </button>
          )}
        </Section>
      )}

      {r.ok.length > 0 && (
        <Section tone="good" icon={<CheckCircle2 size={16} />} label={`${r.ok.length} in place`} preview={r.ok.map((m) => m.product)}>
          <ul className="ts-list present">
            {r.ok.map((m) => (
              <li key={m.product}>
                <span className="ts-name">
                  {m.product}
                  <small>{shelfLabel(m.shelves)}</small>
                </span>
                <span className="pill good">
                  {m.found}/{m.expected}
                </span>
              </li>
            ))}
          </ul>
          {onShow && (
            <button className="btn ghost full" onClick={() => onShow('pog_ok')}>
              Show them on the photo (green)
            </button>
          )}
        </Section>
      )}

      {r.uncheckable.length > 0 && (
        <Section
          tone="slow"
          icon={<PackageX size={16} />}
          label={`${r.uncheckable.length} can't be checked yet`}
          preview={r.uncheckable.map((m) => m.product)}
        >
          <div className="ts-subhead slow">No photos of these in the product library yet, so check them by eye.</div>
          <ul className="ts-list">
            {r.uncheckable.map((m) => (
              <li key={m.product}>
                <span className="ts-name">
                  {m.product}
                  <small>{shelfLabel(m.shelves)}</small>
                </span>
                <span className="pill">{facingsText(m.expected)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {viewing && <Viewer item={pog.item} onClose={() => setViewing(false)} />}
    </section>
  );
}
