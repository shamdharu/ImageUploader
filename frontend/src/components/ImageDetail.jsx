import { useEffect, useState } from 'react';
import { api, authUrl } from '../api.js';

const LABELS = { thumbnail: 'Thumbnail', web: 'Web', hd: 'HD', original: 'Original', print: 'Print' };
const CAT = { file_upload: 'File upload', webcam: 'Webcam', mobile_camera: 'Mobile camera' };
const ORDER = ['thumbnail', 'web', 'hd', 'original', 'print'];
const fmtBytes = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

function pickDefault(d) {
  const kinds = new Set(d.variants.map((v) => v.type));
  for (const v of ['web', 'hd', 'thumbnail', 'original']) if (kinds.has(v)) return v;
  return 'original';
}

export default function ImageDetail({ imageId, onClose }) {
  const [data, setData] = useState(null);
  const [variant, setVariant] = useState('web');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    api.image(imageId)
      .then((d) => {
        setData(d);
        setVariant(pickDefault(d));
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  // Is this variant both generated AND permitted for the acting user?
  function canShow(v) {
    if (!data) return false;
    if (!data.variants.some((x) => x.type === v)) return false;
    const max = data.permissions.maxDownload; // 'web' | 'hd' | 'original'
    if (v === 'thumbnail' || v === 'web') return true;
    if (v === 'hd') return max === 'hd' || max === 'original';
    if (v === 'original') return max === 'original';
    if (v === 'print') return data.permissions.canPrint;
    return false;
  }

  async function doDownload() {
    setError(null);
    try {
      const d = await api.download(imageId, variant);
      window.open(authUrl(d.url), '_blank', 'noopener');
    } catch (e) {
      setError(e.message);
    }
  }

  async function doPrint() {
    setError(null);
    try {
      const d = await api.print(imageId);
      // Server audits the print action; browser opens the print-optimised JPEG.
      window.open(authUrl(d.url), '_blank', 'noopener');
    } catch (e) {
      setError(e.message);
    }
  }

  if (busy) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal"><div className="muted">Loading image…</div></div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="error">{error || 'Could not load image.'}</div>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const { image, permissions } = data;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <h3>{image.filename || `image #${image.id}`}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="meta-row small">
          <span>{image.widthPx}×{image.heightPx} px</span>
          <span>{fmtBytes(image.fileSizeBytes)}</span>
          <span>{CAT[image.source] || image.source}</span>
          <span>by {image.uploadedBy}</span>
          <span className="role-pill">{image.status}</span>
        </div>

        {image.status === 'ready' ? (
          <img
            className="big-img"
            src={authUrl(`/images/${image.id}/file?variant=${variant}`)}
            alt={image.filename || `image #${image.id}`}
          />
        ) : (
          <div className="tile-mid">{image.status === 'processing' ? '… still processing …' : 'processing failed'}</div>
        )}

        <div className="variant-row">
          {ORDER.filter(canShow).map((v) => (
            <button key={v} type="button" className={'var-btn' + (variant === v ? ' on' : '')} onClick={() => setVariant(v)}>
              {LABELS[v]}
            </button>
          ))}
        </div>
        <div className="muted small">
          Showing {LABELS[variant] || variant} · your max download is {permissions.maxDownload} · print: {permissions.canPrint ? 'allowed' : 'not allowed'}
          · every serve is audited server-side.
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row right">
          <button type="button" className="primary" onClick={doDownload}>
            Download {LABELS[variant] || variant}
          </button>
          {permissions.canPrint && (
            <button type="button" className="primary print" onClick={doPrint}>Print preview</button>
          )}
        </div>
      </div>
    </div>
  );
}