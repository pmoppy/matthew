import { useState } from 'react';
import { clearCatalog, clearEmbeddingCache } from '../lib/catalog';
import { clearModelCache, getSession } from '../lib/ort';
import { DEFAULT_SETTINGS, EMBEDDERS, getEmbedder, type Settings } from '../lib/types';

interface Props {
  settings: Settings;
  setSettings: (s: Settings) => void;
}

export function SettingsView({ settings, setSettings }: Props) {
  const [test, setTest] = useState<string | null>(null);
  const upd = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  const testModel = async (url: string, dataUrl?: string) => {
    setTest('Loading…');
    try {
      const s = await getSession(url, (f) => setTest(`Downloading ${Math.round(f * 100)}%`), dataUrl);
      setTest(`OK · inputs: ${s.inputNames.join(', ')} · outputs: ${s.outputNames.join(', ')}`);
    } catch (e) {
      setTest(`Failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="view">
      <header className="page-head">
        <h1>Settings</h1>
        <p>Detection models, match confidence and the sales rules behind the colours.</p>
      </header>
      <div className="card">
        <h2>Models</h2>
        <label className="field">
          <span>Product detector (YOLO ONNX URL)</span>
          <input className="input" value={settings.detectorUrl} placeholder="Blank = basic shelf-grid detector" onChange={(e) => upd('detectorUrl', e.target.value.trim())} />
        </label>
        <p className="muted small">
          Default: YOLO11s trained on SKU-110K (input size 640). A <code>models/detector.onnx</code> in your bucket replaces it on sync.
          Clear the field to use the basic built-in detector.
        </p>
        <div className="row">
          <label className="field">
            <span>Detector input size</span>
            <select className="input" value={settings.detectorInputSize} onChange={(e) => upd('detectorInputSize', Number(e.target.value))}>
              {[640, 800, 1024, 1280].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Detector confidence ({settings.detectorConfidence.toFixed(2)})</span>
            <input type="range" min={0.1} max={0.8} step={0.05} value={settings.detectorConfidence} onChange={(e) => upd('detectorConfidence', Number(e.target.value))} />
          </label>
        </div>
        {settings.detectorUrl && (
          <button className="btn" onClick={() => testModel(settings.detectorUrl)}>
            Test detector
          </button>
        )}
        <label className="field">
          <span>SKU recognition model</span>
          <select
            className="input"
            value={settings.embedderId}
            onChange={(e) => {
              const spec = getEmbedder(e.target.value);
              // Each model has its own calibrated confidence rule.
              setSettings({ ...settings, embedderId: spec.id, matchThreshold: spec.matchThreshold, marginThreshold: spec.marginThreshold });
            }}
          >
            {EMBEDDERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.sizeMb} MB · {m.licence}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">Changing it re-learns the product library on every phone (one-off download of the new model).</p>
        <button className="btn" onClick={() => testModel(getEmbedder(settings.embedderId).url, getEmbedder(settings.embedderId).dataUrl)}>
          Test recognition model
        </button>
        {test && <p className="small mono">{test}</p>}
      </div>

      <div className="card">
        <h2>Matching</h2>
        <label className="field">
          <span>Confident match threshold ({Math.round(settings.matchThreshold * 100)}%)</span>
          <input type="range" min={0.5} max={0.98} step={0.01} value={settings.matchThreshold} onChange={(e) => upd('matchThreshold', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Required lead over 2nd-best match ({(settings.marginThreshold * 100).toFixed(1)}%)</span>
          <input type="range" min={0} max={0.1} step={0.005} value={settings.marginThreshold} onChange={(e) => upd('marginThreshold', Number(e.target.value))} />
        </label>
        <p className="muted small">Higher values mean more amber "unsure" boxes but fewer wrong labels.</p>
      </div>

      <div className="card">
        <h2>Sales rules</h2>
        <label className="field">
          <span>Top sellers = top {settings.topSellerPercent}% of products</span>
          <input type="range" min={5} max={50} step={5} value={settings.topSellerPercent} onChange={(e) => upd('topSellerPercent', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Delist candidates = bottom {settings.delistPercent}% of products</span>
          <input type="range" min={0} max={40} step={5} value={settings.delistPercent} onChange={(e) => upd('delistPercent', Number(e.target.value))} />
        </label>
      </div>

      <div className="card">
        <h2>Storage</h2>
        <div className="row wrap">
          <button className="btn ghost" onClick={async () => { await clearModelCache(); setTest('Model cache cleared'); }}>
            Clear downloaded models
          </button>
          <button className="btn ghost" onClick={async () => { await clearEmbeddingCache(); await clearCatalog(); location.reload(); }}>
            Clear catalogue cache
          </button>
          <button className="btn ghost" onClick={() => setSettings({ ...DEFAULT_SETTINGS, catalogUrl: settings.catalogUrl })}>
            Reset settings
          </button>
        </div>
        <p className="muted small">Everything (photos, catalogue, corrections) stays on this device. Nothing is uploaded.</p>
      </div>
    </div>
  );
}
