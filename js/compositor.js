/* ============================================================
   PixelPeel — compositor.js
   El "secreto" de calidad: los canales R,G,B ORIGINALES nunca
   se tocan. La máscara del modelo (≈1024²) se escala al tamaño
   real con interpolación de alta calidad y se escribe SOLO en
   el canal alpha de los píxeles originales.
   ============================================================ */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* La máscara de 1 canal del modelo → canvas a resolución ORIGINAL.
   Se dibuja como gris (v,v,v,255) para poder escalar/difuminar con
   la calidad de interpolación del navegador y leer el canal R. */
export function buildBaseMaskCanvas(maskData, mw, mh, W, H) {
  const small = makeCanvas(mw, mh);
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(mw, mh);
  const d = img.data;
  for (let p = 0, i = 0; p < maskData.length; p++, i += 4) {
    const v = maskData[p];
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const base = makeCanvas(W, H);
  const bctx = base.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, W, H);
  bctx.drawImage(small, 0, 0, W, H);
  return base;
}

/* Recalcula item.maskFull (Uint8ClampedArray W*H) combinando:
   base del modelo (con suavizado opcional) + trazos manuales.
   Los trazos (blanco = restaurar, negro = borrar) se mantienen
   nítidos a propósito: el control manual debe ser predecible. */
export function rebuildMask(item, featherPx) {
  const { width: W, height: H } = item;
  if (!item.workCanvas) {
    item.workCanvas = makeCanvas(W, H);
    item.workCtx = item.workCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = item.workCtx;
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (featherPx > 0) ctx.filter = `blur(${featherPx}px)`;
  ctx.drawImage(item.baseMaskCanvas, 0, 0);
  ctx.filter = 'none';
  ctx.drawImage(item.strokesCanvas, 0, 0);

  const d = ctx.getImageData(0, 0, W, H).data;
  if (!item.maskFull || item.maskFull.length !== W * H) {
    item.maskFull = new Uint8ClampedArray(W * H);
  }
  const m = item.maskFull;
  for (let p = 0, i = 0; p < m.length; p++, i += 4) m[p] = d[i];
}

/* Aplica la máscara al alpha de los píxeles originales. */
export function updateSubject(item) {
  const { width: W, height: H } = item;
  if (!item.subjectCanvas) item.subjectCanvas = makeCanvas(W, H);

  const src = item.imageData.data;
  const m = item.maskFull;
  if (!item._subjectBuf || item._subjectBuf.length !== src.length) {
    item._subjectBuf = new Uint8ClampedArray(src.length);
  }
  const out = item._subjectBuf;
  out.set(src);
  for (let p = 0, i = 3; p < m.length; p++, i += 4) {
    const a = out[i];
    out[i] = a === 255 ? m[p] : ((a * m[p]) / 255) | 0; // respeta alpha original (PNG con transparencia)
  }
  item.subjectCanvas.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
}

/* ---------- fondo + sombra ---------- */

function paintBackground(ctx, W, H, bg) {
  if (bg.type === 'color') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'gradient') {
    const a = ((bg.angle - 90) * Math.PI) / 180;
    const r = Math.hypot(W, H) / 2;
    const cx = W / 2;
    const cy = H / 2;
    const g = ctx.createLinearGradient(
      cx - Math.cos(a) * r, cy - Math.sin(a) * r,
      cx + Math.cos(a) * r, cy + Math.sin(a) * r,
    );
    g.addColorStop(0, bg.colorA);
    g.addColorStop(1, bg.colorB);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'image' && bg.image) {
    const iw = bg.image.width;
    const ih = bg.image.height;
    const s = Math.max(W / iw, H / ih); // cover
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(bg.image, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  // 'transparent' → no se pinta nada
}

/* Compone fondo + sombra + sujeto en item.finalCanvas (resolución original). */
export function renderFinal(item, settings) {
  const { width: W, height: H } = item;
  if (!item.finalCanvas) item.finalCanvas = makeCanvas(W, H);
  const ctx = item.finalCanvas.getContext('2d');

  ctx.clearRect(0, 0, W, H);
  paintBackground(ctx, W, H, settings.bg);

  if (settings.shadow.enabled) {
    // Escala relativa: la sombra se ve igual en una foto de 800px que en una de 6000px.
    const k = Math.max(W, H) / 1600;
    const s = settings.shadow;
    ctx.filter = `drop-shadow(${(s.dx * k).toFixed(1)}px ${(s.dy * k).toFixed(1)}px ${(s.blur * k).toFixed(1)}px rgba(0,0,0,${s.opacity}))`;
  }
  ctx.drawImage(item.subjectCanvas, 0, 0);
  ctx.filter = 'none';
}

/* ---------- exportación ---------- */

const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };
export const FORMAT_EXT = { png: 'png', webp: 'webp', jpg: 'jpg' };

export async function exportBlob(item, settings, format, quality) {
  renderFinal(item, settings);
  let canvas = item.finalCanvas;

  if (format === 'jpg') {
    // JPG no soporta transparencia: aplanar sobre blanco.
    const flat = makeCanvas(canvas.width, canvas.height);
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo generar el archivo'))),
      MIME[format] || 'image/png',
      format === 'png' ? undefined : quality,
    );
  });
}

/* ---------- utilidades ---------- */

export function makeThumb(source, size = 88) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const sw = source.width;
  const sh = source.height;
  const s = Math.max(size / sw, size / sh);
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return c.toDataURL('image/jpeg', 0.72);
}
