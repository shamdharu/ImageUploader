import { useEffect, useRef, useState } from 'react';
import { api, uploadImage } from '../api.js';

export default function UploadModal({ categories, onClose, onDone }) {
  const [source, setSource] = useState('file'); // file | webcam
  const [catId, setCatId] = useState(categories[0]?.id);
  const [file, setFile] = useState(null);
  const [capture, setCapture] = useState(null); // webcam frame { blob, name, url }
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  function stopWebcam() {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => stopWebcam, []);

  function pickFile(f) {
    setFile(f);
    setCapture(null);
    stopWebcam();
  }

  async function startWebcam() {
    setError(null);
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
      }
    } catch {
      setError('Webcam unavailable or permission denied.');
    }
  }

  async function captureFrame() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setError('Start the camera and wait a moment before capturing.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    const blob = await canvas.toBlob();
    const name = `webcam-${Date.now()}.png`;
    setCapture({ blob, name, url: URL.createObjectURL(blob) });
    setFile(null);
    setError(null);
  }

  async function pollJob(jobId) {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const d = await api.job(jobId);
        setJob(d.job);
        if (d.job.status === 'completed') { onDone(); return; }
        if (d.job.status === 'failed') { setError(d.job.errorMessage || 'Processing failed'); setBusy(false); return; }
      } catch {
        /* transient network error - keep polling */
      }
    }
  }

  async function submit() {
    const chosen = capture || file;
    if (!chosen) {
      setError('Pick a file or capture a webcam frame first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const toSend = chosen.blob
        ? new File([chosen.blob], chosen.name, { type: 'image/png' })
        : chosen;
      const r = await uploadImage(catId, toSend, source === 'webcam' ? 'webcam' : 'file_upload');
      setJob({ id: r.jobId, status: 'queued', progressPercent: 0, errorMessage: null });
      pollJob(r.jobId);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <h3>Upload image</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="close">✕</button>
        </div>

        {categories.length === 0 ? (
          <div className="error">You cannot upload to any category with your current role.</div>
        ) : (
          <>
            <label className="field">
              Category
              <select value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>#{c.id} {c.name}</option>
                ))}
              </select>
            </label>

            <div className="seg">
              <button type="button" className={source === 'file' ? 'on' : ''} onClick={() => setSource('file')}>File</button>
              <button type="button" className={source === 'webcam' ? 'on' : ''} onClick={() => setSource('webcam')}>Webcam</button>
            </div>

            {source === 'file' && (
              <label className="file-pick">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  capture="environment"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
                <div className="file-name small">{file ? `✓ ${file.name}` : 'Choose a JPEG / PNG / WebP / HEIC image…'}</div>
              </label>
            )}

            {source === 'webcam' && (
              <div className="webcam-box">
                <video ref={videoRef} playsInline muted className="video" />
                {capture && <img src={capture.url} className="cap" alt="captured frame" />}
                <div className="row small">
                  <button type="button" className="ghost" onClick={startWebcam}>
                    {streamRef.current ? 'Camera on ✅' : 'Start camera'}
                  </button>
                  <button type="button" className="ghost" onClick={captureFrame}>Capture frame</button>
                  {capture && <button type="button" className="ghost" onClick={() => setCapture(null)}>Clear</button>}
                </div>
                {capture && <div className="ok small">Captured {capture.name} — ready to upload.</div>}
              </div>
            )}

            {error && <div className="error">{error}</div>}

            {job && (
              <div className="job">
                <div>Accepted — generating thumbnail / web / HD / print variants…</div>
                <progress max="100" value={job.progressPercent} />
                <div className="muted small">{job.status} · {job.progressPercent}%</div>
              </div>
            )}

            <div className="row right">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" onClick={submit} disabled={busy || !!job}>Upload</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}