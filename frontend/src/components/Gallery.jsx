import { useEffect, useState } from 'react';
import { api, authUrl } from '../api.js';
import UploadModal from './UploadModal.jsx';
import ImageDetail from './ImageDetail.jsx';

const ROLE = { admin: 'Admin', manager: 'Manager', contributor: 'Contributor', viewer: 'Viewer' };
const SOURCE = { file_upload: 'File', webcam: 'Webcam', mobile_camera: 'Mobile' };
const fmtBytes = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);
const canCreateCategory = (role) => role === 'admin' || role === 'manager';

export default function Gallery({ user, onLogout }) {
  const [categories, setCategories] = useState([]);
  const [catId, setCatId] = useState(null);
  const [images, setImages] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [assignEmail, setAssignEmail] = useState('');

  async function reloadImages() {
    if (!catId) return;
    const d = await api.listImages(catId);
    setImages(d.images);
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.categories();
      setCategories(d.categories);
      const current = catId && d.categories.some((c) => c.id === catId) ? catId : d.categories[0]?.id;
      setCatId(current);
      setImages(current ? (await api.listImages(current)).images : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while images are still processing in the background
  useEffect(() => {
    if (images.some((i) => i.status === 'processing')) {
      const t = setTimeout(() => reloadImages().catch(() => {}), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  async function selectCategory(id) {
    setCatId(id);
    setError(null);
    try {
      setImages((await api.listImages(id)).images);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createCategory() {
    const name = newCat.trim();
    if (!name) return;
    try {
      const d = await api.createCategory(name);
      setNotice(`Created category #${d.category.id} "${d.category.name}"`);
      setNewCat('');
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function assignUser() {
    const email = assignEmail.trim();
    if (!email || !catId) return;
    try {
      const d = await api.assignCategory(catId, email);
      setNotice(d.message);
      setAssignEmail('');
    } catch (e) {
      setError(e.message);
    }
  }

  const uploadable = categories.filter((c) => c.canUpload);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📷 Image Platform</div>
        <div className="who">
          <span className="role-pill">{ROLE[user.role] || user.role}</span>
          <span>{user.fullName} · {user.email}</span>
          <button type="button" className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {error && <div className="error banner" onClick={() => setError(null)}>✕ {error}</div>}
      {notice && <div className="ok banner" onClick={() => setNotice(null)}>✓ {notice}</div>}

      <nav className="cats">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={'cat-tab' + (c.id === catId ? ' on' : '')}
            onClick={() => selectCategory(c.id)}
          >
            <span className="cat-num">#{c.id}</span>
            {c.name}
            <span className="cat-count">{c.imageCount}</span>
          </button>
        ))}
        {categories.length === 0 && <span className="muted">No categories available for your role.</span>}
        {uploadable.length > 0 && (
          <button type="button" className="primary small" onClick={() => setUploadOpen(true)}>+ Upload</button>
        )}
      </nav>

      {canCreateCategory(user.role) && (
        <div className="manage">
          <input className="field" placeholder="New category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button type="button" className="ghost" onClick={createCategory}>Create category</button>
          <span className="sep">·</span>
          <input className="field" placeholder={`Share category #${catId ?? '…'} with email`} value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} />
          <button type="button" className="ghost" onClick={assignUser}>Share category</button>
        </div>
      )}

      <main className="grid">
        {images.map((im) => (
          <div key={im.id} className="card" onClick={() => setDetailId(im.id)} title={im.filename || `image #${im.id}`}>
            {im.status === 'ready' ? (
              <img src={authUrl(im.thumbnailUrl)} alt={im.filename} loading="lazy" />
            ) : im.status === 'processing' ? (
              <div className="tile-mid">… processing …</div>
            ) : (
              <div className="tile-mid bad">processing failed</div>
            )}
            <div className="meta">
              <strong>{im.filename || `image #${im.id}`}</strong>
              <span>
                {im.widthPx}×{im.heightPx} · {fmtBytes(im.fileSizeBytes)} · {SOURCE[im.source] || im.source} · by {im.uploadedBy}
              </span>
            </div>
          </div>
        ))}
        {!busy && images.length === 0 && (
          <div className="empty">
            This category is empty.
            {uploadable.length > 0 ? ' Use “+ Upload” to add the first image.' : 'Your role cannot upload here.'}
          </div>
        )}
      </main>

      {uploadOpen && (
        <UploadModal
          categories={uploadable}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); refresh(); }}
        />
      )}
      {detailId && (
        <ImageDetail imageId={detailId} onClose={() => setDetailId(null)} onChanged={() => reloadImages().catch(() => {})} />
      )}
    </div>
  );
}