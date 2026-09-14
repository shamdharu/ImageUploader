import { useState, useEffect } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './components/Login.jsx';
import Gallery from './components/Gallery.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="splash">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Gallery user={user} onLogout={() => { setToken(null); setUser(null); }} />;
}