import { Loader2, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { signedInAs, signIn } from '../lib/auth';

/** Shows the sign-in screen until the tester has signed in on this device (remembered after that). */
export function SignInGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState(() => signedInAs());
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await signIn(name, pass)) setUser(name.trim());
      else setError('Wrong username or password.');
    } catch {
      setError("Couldn't check the password on this browser.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card card" onSubmit={submit}>
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={56} height={56} />
        <h1>ShelfScan</h1>
        <p className="muted">Sign in to try the app.</p>
        <label>
          <span>Username</span>
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary full" disabled={busy || !name || !pass}>
          {busy ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />} Sign in
        </button>
      </form>
    </div>
  );
}
