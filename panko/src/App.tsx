import type Anthropic from '@anthropic-ai/sdk';
import { ArrowUp, BarChart3, Database, FileText, Menu, MessageSquarePlus, Settings as Cog, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Anthropic_ from '@anthropic-ai/sdk';
import { Lock } from './components/Lock';
import { Markdown } from './components/Markdown';
import { DataPanel, ReportsPanel, SettingsPanel } from './components/Panels';
import { ReportCard } from './components/ReportCard';
import { explainError, repairHistory, runTurn } from './lib/agent';
import { checkPassword } from './lib/auth';
import { onBackButton } from './lib/native';
import { parseFile, type Dataset } from './lib/data';
import * as store from './lib/store';
import type { Conversation, Memory, MessageParam, Report, ReportSection, Settings } from './lib/store';
import { toolLabel } from './lib/tools';

const SUGGESTIONS = [
  'What are the best sellers?',
  'Which store sells the most energy drinks?',
  'Build me a report on crisps sales by store',
  'What did we talk about last time?',
];

type Panel = 'data' | 'reports' | 'settings' | null;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memories, setMemoriesState] = useState<Memory[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [live, setLive] = useState('');
  const [activity, setActivity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState('');
  const [locked, setLocked] = useState(true);
  const [lockMsg, setLockMsg] = useState('');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const memRef = useRef<Memory[]>([]);

  const loadDemo = useCallback(async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/sales.csv`);
    if (!res.ok) throw new Error('Could not load the demo data.');
    const ds = parseFile(await res.text(), 'Demo sales.csv');
    await store.saveDataset(ds);
    setDatasets((d) => [...d, ds]);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, ds, cs, ms, rs] = await Promise.all([
        store.loadSettings(),
        store.listDatasets(),
        store.listConversations(),
        store.listMemories(),
        store.listReports(),
      ]);
      setSettings(s);
      setDatasets(ds);
      setConversations(cs);
      setMemoriesState(ms);
      memRef.current = ms;
      setReports(rs);
      if (!ds.length && !(await store.getFlag('demo'))) {
        await store.setFlag('demo');
        loadDemo().catch(() => {});
      }
      if (s.mode === 'key') {
        setLocked(!s.apiKey);
        if (!s.apiKey) setPanel('settings');
      } else if (s.serverUrl && s.accessCode) {
        // Remembered from last time. Re-check quietly; if the password has been changed, lock.
        setLocked(false);
        checkPassword(s.serverUrl, s.accessCode).then((r) => {
          if (r === 'wrong') lock(s, 'The password has changed. Enter the new one.');
        });
      }
    })();
  }, [loadDemo]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [current?.messages.length, live, activity]);

  function lock(s: Settings, message = '') {
    const next = { ...s, accessCode: '' };
    setSettings(next);
    store.saveSettings(next);
    setLockMsg(message);
    setPanel(null);
    setDrawer(false);
    setLocked(true);
  }

  // Android back button: close whatever is open before leaving the app.
  const backState = useRef({ panel, drawer });
  backState.current = { panel, drawer };
  useEffect(
    () =>
      onBackButton(() => {
        if (backState.current.panel) setPanel(null);
        else if (backState.current.drawer) setDrawer(false);
        else return false;
        return true;
      }),
    [],
  );

  const setMemories = async (m: Memory[]) => {
    memRef.current = m;
    setMemoriesState(m);
    await store.saveMemories(m);
  };

  const persist = (c: Conversation) => {
    setCurrent(c);
    setConversations((all) => [c, ...all.filter((x) => x.id !== c.id)]);
    store.saveConversation(c);
  };

  async function send(text: string) {
    text = text.trim();
    if (!text || busy || !settings) return;
    setError('');
    setDraft('');
    const now = new Date().toISOString();
    let conv: Conversation = current ?? { id: crypto.randomUUID(), title: text.slice(0, 60), createdAt: now, updatedAt: now, messages: [] };
    const history: MessageParam[] = [...repairHistory(conv.messages), { role: 'user', content: text }];
    conv = { ...conv, messages: history, updatedAt: now };
    persist(conv);
    setBusy(true);
    setActivity('Thinking…');
    const ac = new AbortController();
    abort.current = ac;
    let latest = history;
    try {
      await runTurn(
        settings,
        history,
        {
          datasets,
          conversations,
          currentConversationId: conv.id,
          get memories() {
            return memRef.current;
          },
          setMemories,
          addReport: async (r) => {
            await store.saveReport(r);
            setReports((rs) => [r, ...rs]);
          },
        },
        {
          onText: (t) => {
            setLive(t);
            if (t) setActivity('');
          },
          onTool: (label) => setActivity(`${label}…`),
          onMessages: (m) => {
            latest = m;
            setActivity('Thinking…');
            persist({ ...conv, messages: m, updatedAt: new Date().toISOString() });
          },
        },
        ac.signal,
      );
    } catch (e) {
      if (e instanceof Anthropic_.PermissionDeniedError && settings.mode === 'server') lock(settings, 'The password has changed. Enter the new one.');
      setError(explainError(e));
      persist({ ...conv, messages: repairHistory(latest), updatedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
      setLive('');
      setActivity('');
      abort.current = null;
    }
  }

  const newChat = () => {
    if (busy) return;
    setCurrent(null);
    setError('');
    setDrawer(false);
  };

  if (!settings) return <div className="boot">Panko</div>;
  if (locked && !(settings.mode === 'key' && panel === 'settings'))
    return (
      <Lock
        serverUrl={settings.serverUrl}
        message={lockMsg}
        onUnlock={(serverUrl, accessCode) => {
          const next: Settings = { ...settings, mode: 'server', serverUrl, accessCode };
          setSettings(next);
          store.saveSettings(next);
          setLockMsg('');
          setLocked(false);
        }}
        onOwnKey={() => {
          setSettings({ ...settings, mode: 'key' });
          setPanel('settings');
        }}
      />
    );

  return (
    <div className={`app ${drawer ? 'drawer-open' : ''}`}>
      <aside className="sidebar">
        <div className="side-head">
          <Logo />
          <button className="ghost sm" onClick={newChat}>
            <MessageSquarePlus size={18} aria-hidden /> New chat
          </button>
        </div>
        <nav className="history" aria-label="Past conversations">
          {conversations.length === 0 && <p className="muted small pad">Your conversations will appear here.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={`hist-item ${current?.id === c.id ? 'on' : ''}`}>
              <button
                className="row-btn grow"
                onClick={() => {
                  if (busy) return;
                  setCurrent(c);
                  setError('');
                  setDrawer(false);
                }}
              >
                <span className="ellipsis">{c.title}</span>
                <span className="muted small">{new Date(c.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </button>
              <button
                className="icon sm"
                aria-label="Delete conversation"
                onClick={() => {
                  if (!confirm('Delete this conversation?')) return;
                  store.deleteConversation(c.id);
                  setConversations((all) => all.filter((x) => x.id !== c.id));
                  if (current?.id === c.id) setCurrent(null);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} />

      <main className="main">
        <header className="topbar">
          <button className="icon menu-btn" aria-label="Conversations" onClick={() => setDrawer(true)}>
            <Menu size={22} />
          </button>
          <span className="top-logo">
            <Logo />
          </span>
          <span className="spacer" />
          <button className="chip" onClick={() => setPanel('data')}>
            <Database size={16} aria-hidden /> Data{datasets.length ? ` · ${datasets.length}` : ''}
          </button>
          <button className="chip" aria-label="Reports" onClick={() => setPanel('reports')}>
            <FileText size={16} aria-hidden /> <span className="chip-label">Reports</span>
          </button>
          <button className="icon" aria-label="Settings" onClick={() => setPanel('settings')}>
            <Cog size={20} />
          </button>
        </header>

        <div className="thread">
          {!current || current.messages.length === 0 ? (
            <div className="welcome">
              <div className="hero-mark" aria-hidden>
                <BarChart3 size={30} />
              </div>
              <h1>Hi, I’m Panko.</h1>
              <p className="muted">
                Ask me about your data, get a report built, or pick up where we left off.
                {datasets.length > 0 && (
                  <>
                    {' '}
                    I can see <strong>{datasets.map((d) => d.name).join(', ')}</strong>.
                  </>
                )}
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Messages conv={current} reports={reports} />
          )}
          {live && (
            <div className="msg assistant">
              <Markdown text={live} />
            </div>
          )}
          {activity && (
            <div className="activity" aria-live="polite">
              <span className="dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {activity}
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
              {/(Settings|key|access code)/.test(error) && (
                <button className="ghost sm" onClick={() => setPanel('settings')}>
                  Open Settings
                </button>
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            value={draft}
            rows={1}
            placeholder="Ask Panko…"
            aria-label="Message"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          {busy ? (
            <button type="button" className="send stop" aria-label="Stop" onClick={() => abort.current?.abort()}>
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
              <ArrowUp size={20} />
            </button>
          )}
        </form>
      </main>

      {panel === 'data' && (
        <DataPanel
          datasets={datasets}
          onClose={() => setPanel(null)}
          onDemo={loadDemo}
          onDelete={(id) => {
            store.deleteDataset(id);
            setDatasets((d) => d.filter((x) => x.id !== id));
          }}
          onFiles={async (files) => {
            for (const f of Array.from(files)) {
              const ds = parseFile(await f.text(), f.name);
              await store.saveDataset(ds);
              setDatasets((d) => [...d, ds]);
            }
          }}
        />
      )}
      {panel === 'reports' && (
        <ReportsPanel
          reports={reports}
          onClose={() => setPanel(null)}
          onDelete={(id) => {
            store.deleteReport(id);
            setReports((r) => r.filter((x) => x.id !== id));
          }}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          memories={memories}
          onClose={() => setPanel(null)}
          onSave={(s) => {
            setSettings(s);
            store.saveSettings(s);
            if (s.mode === 'key') setLocked(!s.apiKey);
          }}
          onLock={() => lock(settings)}
          onForget={(id) => setMemories(memories.filter((m) => m.id !== id))}
        />
      )}
    </div>
  );
}

function Logo() {
  return (
    <span className="logo">
      <span className="logo-crumb" aria-hidden />
      panko
    </span>
  );
}

function Messages({ conv, reports }: { conv: Conversation; reports: Report[] }) {
  const out: React.ReactNode[] = [];
  conv.messages.forEach((m, i) => {
    if (m.role === 'system' || !m.content) return;
    if (m.role === 'user') {
      if (typeof m.content === 'string')
        out.push(
          <div key={i} className="msg user">
            {m.content}
          </div>,
        );
      return;
    }
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    blocks.forEach((b, j) => {
      const key = `${i}-${j}`;
      if (b.type === 'text' && b.text.trim())
        out.push(
          <div key={key} className="msg assistant">
            <Markdown text={b.text} />
          </div>,
        );
      else if (b.type === 'tool_use') {
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (b.name === 'create_report') {
          const saved = reports.find((r) => r.conversationId === conv.id && r.title === input.title);
          const report: Report = saved ?? {
            id: b.id,
            title: String(input.title ?? 'Report'),
            summary: typeof input.summary === 'string' ? input.summary : undefined,
            sections: Array.isArray(input.sections) ? (input.sections as ReportSection[]) : [],
            createdAt: conv.updatedAt,
          };
          out.push(<ReportCard key={key} report={report} />);
        } else
          out.push(
            <div key={key} className="tool-chip">
              {toolLabel(b.name, input)}
            </div>,
          );
      }
    });
  });
  return <>{out}</>;
}
