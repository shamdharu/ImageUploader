import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CRLFCRLF = Buffer.from('\r\n\r\n');

/**
 * Minimal streaming multipart/form-data parser.
 * Needed because multer 1.x/2.x + busboy hang on Node >= 24 (request body is
 * otherwise delivered fine - see raw-body test). Supports fields + one file
 * per part, writes file parts straight to tmpDir, caps total body size.
 */
export async function parseMultipart(req, { tmpDir, maxBytes = 60 * 1024 * 1024 }) {
  const ct = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]*)"|([^;]+))/i.exec(ct);
  if (!m) return { fields: {}, files: [] };
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());

  const chunks = [];
  let total = 0;
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      total += chunk.length;
      if (total > maxBytes) reject(Object.assign(new Error('Upload too large'), { status: 413 }));
    });
    req.on('end', resolve);
    req.on('error', reject);
  });
  if (total === 0) return { fields: {}, files: [] };
  const body = Buffer.concat(chunks, total);
  chunks.length = 0;

  fs.mkdirSync(tmpDir, { recursive: true });
  const fields = {};
  const files = [];

  let start = 0;
  let finish = false;
  while (!finish) {
    const idx = body.indexOf(boundary, start);
    if (idx < 0) break;
    const part = body.subarray(start, idx);
    if (part.length > 2) {
      const sep = part.indexOf(CRLFCRLF);
      if (sep >= 0) {
        const head = part.subarray(0, sep).toString('latin1');
        const content = part.subarray(sep + 4, part.length - 2);
        let name = null;
        let filename = null;
        let contentType = null;
        for (const line of head.split('\r\n')) {
          if (/^content-disposition:/i.test(line)) {
            const nm = /name="([^"]*)"/i.exec(line);
            if (nm) name = nm[1];
            const fn = /filename="([^"]*)"/i.exec(line);
            if (fn) filename = fn[1];
          } else if (/^content-type:/i.test(line)) {
            contentType = line.substring(line.indexOf(':') + 1).trim();
          }
        }
        if (name) {
          if (filename !== null) {
            let decoded = filename;
            try { decoded = decodeURIComponent(filename); } catch { /* keep raw */ }
            const safeName = path.basename(decoded.replace(/\\/g, '/'));
            const tmpPath = path.join(tmpDir, crypto.randomUUID() + path.extname(safeName));
            await fs.promises.writeFile(tmpPath, content);
            files.push({ field: name, filename: safeName, contentType, tmpPath, size: content.length });
          } else {
            fields[name] = content.toString('utf8');
          }
        }
      }
    }
    const after = idx + boundary.length;
    start = after + 2; // skip the CRLF after the boundary
    if (body[after] === 45 && body[after + 1] === 45) finish = true; // final "--\r\n"
  }
  return { fields, files };
}