/* ══════════════════════════════════════════════════════
   TinyVoice — Shared utilities
   Used by both index.html (PTT) and qr.html (QR tool)
   ══════════════════════════════════════════════════════ */

const SR = 16000;
const NFFT = 1024;
const HOP = 320;
const WLEN = 1024;
const PAD = 352;
const MODEL_BASE = 'https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/main/';

/* ── IndexedDB Model Cache ─────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('focalcodec-models', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('models');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(key) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function setCache(key, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    tx.objectStore('models').put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function delCache(key) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('models', 'readwrite');
    tx.objectStore('models').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function clearModelCache() {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('models', 'readwrite');
    tx.objectStore('models').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ── Model download with cache ─────────────────────── */
async function loadModel(name, onProgress, statusEl) {
  const cached = await getCached(name);
  if (cached && cached.byteLength > 1048576) {
    if (statusEl) statusEl.textContent = `${name} (cached, ${(cached.byteLength / 1048576).toFixed(0)} MB)`;
    onProgress(1);
    return cached;
  }
  if (cached) {
    if (statusEl) statusEl.textContent = `${name} cache corrupt, re-downloading`;
    await delCache(name);
  }

  if (statusEl) statusEl.textContent = `Downloading ${name}...`;
  const resp = await fetch(MODEL_BASE + name);
  const total = +resp.headers.get('Content-Length') || 0;
  const totalMB = total ? (total / 1048576).toFixed(0) + ' MB' : '?';
  const t0 = performance.now();
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
    if (statusEl) {
      const elapsed = (performance.now() - t0) / 1000;
      const speed = elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : '—';
      statusEl.textContent = `${(received / 1048576).toFixed(1)} / ${totalMB} · ${speed} MB/s`;
    }
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }

  try { await setCache(name, result.buffer); } catch (e) {}

  return result.buffer;
}

/* ── iSTFT (inverse Short-Time Fourier Transform) ──── */
function irfft(re, im, n) {
  const fR = new Float32Array(n), fI = new Float32Array(n);
  const h = re.length;
  for (let i = 0; i < h; i++) { fR[i] = re[i]; fI[i] = im[i]; }
  for (let i = h; i < n; i++) { fR[i] = fR[n - i]; fI[i] = -fI[n - i]; }
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) { [fR[i], fR[j]] = [fR[j], fR[i]]; [fI[i], fI[j]] = [fI[j], fI[i]]; }
    let m = n >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }
  for (let s = 2; s <= n; s *= 2) {
    const hs = s / 2, a = 2 * Math.PI / s;
    for (let i = 0; i < n; i += s)
      for (let k = 0; k < hs; k++) {
        const c = Math.cos(a * k), sn = Math.sin(a * k);
        const tR = c * fR[i + hs + k] - sn * fI[i + hs + k];
        const tI = sn * fR[i + hs + k] + c * fI[i + hs + k];
        fR[i + hs + k] = fR[i + k] - tR;
        fI[i + hs + k] = fI[i + k] - tI;
        fR[i + k] += tR;
        fI[i + k] += tI;
      }
  }
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = fR[i] / n;
  return o;
}

function istft(mag, ph, win) {
  const hN = NFFT / 2 + 1, T = mag.length / hN;
  const oS = (T - 1) * HOP + WLEN;
  const o = new Float32Array(oS), wE = new Float32Array(oS);
  for (let t = 0; t < T; t++) {
    const off = t * hN;
    const r = new Float32Array(hN), im = new Float32Array(hN);
    for (let f = 0; f < hN; f++) {
      r[f] = mag[off + f] * Math.cos(ph[off + f]);
      im[f] = mag[off + f] * Math.sin(ph[off + f]);
    }
    const fr = irfft(r, im, NFFT);
    const st = t * HOP;
    for (let i = 0; i < WLEN; i++) {
      o[st + i] += fr[i] * win[i];
      wE[st + i] += win[i] * win[i];
    }
  }
  for (let i = 0; i < oS; i++) if (wE[i] > 1e-8) o[i] /= wE[i];
  return o.slice(PAD, oS - PAD);
}

/* ── Byte formatting ───────────────────────────────── */
function fmt(b) { return b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB'; }
