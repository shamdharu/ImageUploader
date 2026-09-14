const BASE = '/api';

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

/**
 * Build a URL that works from <img> / <a> / window.open where headers
 * cannot be set - the JWT is appended as a query parameter.
 */
export function authUrl(path) {
  const t = getToken();
  const sep = path.includes('?') ? '&' : '?';
  return BASE + path + (t ? `${sep}token=${encodeURIComponent(t)}` : '');
}

async function request(method, url, body) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) setToken(null);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  }
  return data;
}

/** Multipart upload of one image (file picker or captured webcam frame). */
export async function uploadImage(categoryId, file, source) {
  const fd = new FormData();
  fd.append('categoryId', String(categoryId));
  fd.append('source', source);
  fd.append('file', file);
  const token = getToken();
  const res = await fetch(BASE + '/images/uploads', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: fd,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  }
  return data; // { jobId, imageId }
}

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),
  categories: () => request('GET', '/categories'),
  createCategory: (name) => request('POST', '/categories', { name }),
  assignCategory: (id, email) => request('POST', `/categories/${id}/assign`, { email }),
  listImages: (categoryId) => request('GET', `/images?categoryId=${categoryId}`),
  image: (id) => request('GET', `/images/${id}`),
  job: (id) => request('GET', `/jobs/${id}`),
  download: (id, variant) => request('POST', `/images/${id}/download`, { variant }),
  print: (id) => request('POST', `/images/${id}/print`),
};