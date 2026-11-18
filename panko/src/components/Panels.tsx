import { Database, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { Dataset } from '../lib/data';
import { MODELS, type Memory, type Report, type Settings } from '../lib/store';
import { ReportCard } from './ReportCard';

export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </aside>
    </div>
  );
}

export function DataPanel(props: {
  datasets: Dataset[];
  onFiles(files: FileList): Promise<void>;
  onDelete(id: string): void;
  onDemo(): Promise<void>;
  onClose(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const take = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr('');
    try {
      await props.onFiles(files);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Your data" onClose={props.onClose}>
      <p className="muted">Panko answers from the files you add here. They stay on this device; only the rows Panko looks up are sent to the AI.</p>
      <div
        className={`drop ${drag ? 'on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files);
        }}
      >
        <button className="primary" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={18} aria-hidden /> {busy ? 'Loading…' : 'Add a file'}
        </button>
        <span className="muted">CSV, TSV or JSON. Excel: File → Save As → CSV.</span>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,.json" multiple hidden onChange={(e) => take(e.target.files)} />
      </div>
      {err && <p className="error">{err}</p>}
      {props.datasets.length === 0 ? (
        <div className="empty-list">
          <p>No data yet.</p>
          <button className="ghost" onClick={props.onDemo}>
            Load the demo sales data
          </button>
        </div>
      ) : (
        <ul className="list">
          {props.datasets.map((d) => (
            <li key={d.id}>
              <Database size={18} aria-hidden className="list-icon" />
              <div className="grow">
                <strong>{d.name}</strong>
                <div className="muted small">
                  {d.rows.length.toLocaleString('en-GB')} rows · {d.columns.map((c) => c.name).join(', ')}
                </div>
              </div>
              <button className="icon" aria-label={`Remove ${d.name}`} onClick={() => confirm(`Remove “${d.name}”?`) && props.onDelete(d.id)}>
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function ReportsPanel(props: { reports: Report[]; onDelete(id: string): void; onClose(): void }) {
  const [open, setOpen] = useState<Report | null>(null);
  if (open)
    return (
      <Sheet title="Report" onClose={() => setOpen(null)}>
        <button className="ghost sm back" onClick={() => setOpen(null)}>
          ← All reports
        </button>
        <ReportCard report={open} />
      </Sheet>
    );
  return (
    <Sheet title="Saved reports" onClose={props.onClose}>
      {props.reports.length === 0 ? (
        <p className="muted">No reports yet. Try asking “Build me a report on energy drink sales by store”.</p>
      ) : (
        <ul className="list">
          {props.reports.map((r) => (
            <li key={r.id}>
              <button className="row-btn grow" onClick={() => setOpen(r)}>
                <strong>{r.title}</strong>
                <span className="muted small">{new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </button>
              <button className="icon" aria-label="Delete report" onClick={() => confirm(`Delete “${r.title}”?`) && props.onDelete(r.id)}>
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function SettingsPanel(props: {
  settings: Settings;
  memories: Memory[];
  onSave(s: Settings): void;
  onForget(id: string): void;
  onClose(): void;
}) {
  const [s, setS] = useState(props.settings);
  const up = (p: Partial<Settings>) => setS({ ...s, ...p });
  return (
    <Sheet title="Settings" onClose={props.onClose}>
      <section className="field-group">
        <h3>AI connection</h3>
        <div className="seg">
          <button className={s.mode === 'server' ? 'on' : ''} onClick={() => up({ mode: 'server' })}>
            Panko server
          </button>
          <button className={s.mode === 'key' ? 'on' : ''} onClick={() => up({ mode: 'key' })}>
            My own API key
          </button>
        </div>
        {s.mode === 'server' ? (
          <>
            <label>
              Server address
              <input value={s.serverUrl} onChange={(e) => up({ serverUrl: e.target.value.trim() })} placeholder="https://panko-api.<you>.workers.dev" inputMode="url" />
            </label>
            <label>
              Access code
              <input value={s.accessCode} onChange={(e) => up({ accessCode: e.target.value })} type="password" autoComplete="off" />
            </label>
            <p className="muted small">The team’s server keeps the AI key safe. Ask the admin for the address and access code.</p>
          </>
        ) : (
          <>
            <label>
              Anthropic API key
              <input value={s.apiKey} onChange={(e) => up({ apiKey: e.target.value.trim() })} type="password" placeholder="sk-ant-…" autoComplete="off" />
            </label>
            <p className="muted small">Stored on this device only. Fine for trying Panko yourself; for a team, use a Panko server so the key isn’t on every phone.</p>
          </>
        )}
      </section>
      <section className="field-group">
        <h3>Model</h3>
        {MODELS.map((m) => (
          <label key={m.id} className="radio">
            <input type="radio" name="model" checked={s.model === m.id} onChange={() => up({ model: m.id })} />
            <span>
              {m.label} <span className="muted small">· {m.note}</span>
            </span>
          </label>
        ))}
      </section>
      <button
        className="primary wide"
        onClick={() => {
          props.onSave(s);
          props.onClose();
        }}
      >
        Save
      </button>
      <section className="field-group">
        <h3>What Panko remembers</h3>
        {props.memories.length === 0 ? (
          <p className="muted small">Nothing yet. Say “remember that…” and Panko will keep it for future chats.</p>
        ) : (
          <ul className="list">
            {props.memories.map((m) => (
              <li key={m.id}>
                <span className="grow">{m.note}</span>
                <button className="icon" aria-label="Forget" onClick={() => props.onForget(m.id)}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  );
}
