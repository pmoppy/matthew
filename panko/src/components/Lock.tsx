import { Lock as LockIcon } from 'lucide-react';
import { useState } from 'react';
import { ALLOW_OWN_KEY, BUILT_IN_SERVER, checkPassword } from '../lib/auth';

export function Lock(props: { serverUrl: string; message?: string; onUnlock(serverUrl: string, password: string): void; onOwnKey(): void }) {
  const [server, setServer] = useState(props.serverUrl || BUILT_IN_SERVER);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(props.message ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || !server) return;
    setBusy(true);
    setErr('');
    const r = await checkPassword(server, password);
    setBusy(false);
    if (r === 'ok') return props.onUnlock(server.trim().replace(/\/+$/, ''), password);
    setErr(
      r === 'wrong'
        ? 'That password isn’t right.'
        : r === 'offline'
          ? 'Couldn’t reach Panko. Check your internet connection' + (BUILT_IN_SERVER ? '.' : ' and the server address.')
          : 'The Panko server isn’t set up properly. Ask the admin.',
    );
    setPassword('');
  }

  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <span className="logo big">
          <span className="logo-crumb" aria-hidden />
          panko
        </span>
        <div className="lock-icon" aria-hidden>
          <LockIcon size={22} />
        </div>
        <h1>Enter the password</h1>
        {!BUILT_IN_SERVER && (
          <label>
            Server address
            <input value={server} onChange={(e) => setServer(e.target.value.trim())} placeholder="https://panko-api.<you>.workers.dev" inputMode="url" autoCapitalize="off" />
          </label>
        )}
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="primary wide" disabled={busy || !password || !server}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        {ALLOW_OWN_KEY && (
          <button type="button" className="ghost sm" onClick={props.onOwnKey}>
            Developer: use my own API key
          </button>
        )}
      </form>
    </div>
  );
}
