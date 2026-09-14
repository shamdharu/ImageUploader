const BASE = 'http://localhost:5173/api';
const out = [];

async function try_(name, fn) {
  try {
    const r = await fn();
    out.push(`${r ? 'PASS' : 'FAIL'}  ${name}`);
    if (!r) process.exitCode = 1;
  } catch (e) {
    out.push(`FAIL  ${name} -> ${e.message}`);
    process.exitCode = 1;
  }
}

await try_('login via proxy', async () => {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.io', password: 'admin123' }),
  });
  return (await r.json()).token ? true : false;
});

await try_('upload a file through the vite proxy', async () => {
  const mod = await import('sharp');
  const buf = await mod.default({ create: { width: 320, height: 240, channels: 3, background: { r: 9, g: 87, b: 173 } } }).jpeg().toBuffer();
  const login = await (await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'contributor@demo.io', password: 'contributor123' }),
  })).json();
  const fd = new FormData();
  fd.append('categoryId', '1002');
  fd.append('source', 'file_upload');
  fd.append('file', new File([buf], 'proxy-test.jpg', { type: 'image/jpeg' }));
  const res = await fetch(BASE + '/images/uploads', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + login.token },
    body: fd,
  });
  const d = await res.json();
  if (res.status !== 202 || !d.jobId) return false;
  // wait for job completion
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const j = await (await fetch(BASE + `/jobs/${d.jobId}`, { headers: { Authorization: 'Bearer ' + login.token } })).json();
    if (j.job?.status === 'completed') return true;
  }
  return false;
});

console.log(out.join('\n'));
console.log(out.every((l) => l.startsWith('PASS')) ? '\nPROXY E2E OK' : '\nPROXY E2E FAILED');