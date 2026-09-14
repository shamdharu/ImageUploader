import { useState } from 'react';
import { api, setToken } from '../api.js';

const DEMO = [
  { label: 'Admin', email: 'admin@demo.io', password: 'admin123', hint: 'sees & manages everything' },
  { label: 'Manager', email: 'manager@demo.io', password: 'manager123', hint: 'owns 1002, assigned to 1001 · can print' },
  { label: 'Contributor', email: 'contributor@demo.io', password: 'contributor123', hint: 'uploads · downloads ≤ Web' },
  { label: 'Viewer', email: 'viewer@demo.io', password: 'viewer123', hint: 'view-only · category 1001' },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState(DEMO[0].email);
  const [password, setPassword] = useState(DEMO[0].password);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api.login(email.trim(), password);
      setToken(d.token);
      onLogin(d.user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>📷 Image Platform</h1>
        <p className="subtitle">
          Upload · View · Download · Print — a very basic local implementation of the
          Requirements / Data Model / System Architecture docs.
        </p>

        <div className="demo-grid">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              className={'demo-btn' + (email === d.email && password === d.password ? ' on' : '')}
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
                setError(null);
              }}
            >
              <strong>{d.label}</strong>
              <span>{d.hint}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}