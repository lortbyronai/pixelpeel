/* ============================================================
   PixelPeel — main.js
   Orquestación: cola por lotes, worker de inferencia, edición,
   ajustes globales y exportación.
   ============================================================ */

import {
  buildBaseMaskCanvas, rebuildMask, updateSubject, renderFinal,
  exportBlob, makeThumb, FORMAT_EXT,
} from './compositor.js';
import { Editor, isTyping } from './editor.js';

/* ---------------- referencias DOM ---------------- */

const $ = (id) => document.getElementById(id);

const el = {
  modelChip: $('modelChip'), modelLabel: $('modelLabel'), modelBarFill: $('modelBarFill'),
  queueList: $('queueList'), railEmpty: $('railEmpty'),
  btnAdd: $('btnAdd'), btnPick: $('btnPick'), btnZipAll: $('btnZipAll'),
  fileInput: $('fileInput'), bgImageInput: $('bgImageInput'),
  stage: $('stage'), stageTransform: $('stageTransform'), canvasStack: $('canvasStack'),
  compareDivider: $('compareDivider'), brushCursor: $('brushCursor'),
  emptyState: $('emptyState'), stageStatus: $('stageStatus'), stageStatusText: $('stageStatusText'),
  dropHint: $('dropHint'),
  imgInfo: $('imgInfo'), editHint: $('editHint'), zoomLabel: $('zoomLabel'),
  toolPan: $('toolPan'), toolRestore: $('toolRestore'), toolErase: $('toolErase'),
  toolCompare: $('toolCompare'),
  brushRange: $('brushRange'), brushOut: $('brushOut'),
  btnUndo: $('btnUndo'), btnRedo: $('btnRedo'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'),
  bgChips: $('bgChips'), bgColorRow: $('bgColorRow'), bgColor: $('bgColor'),
  bgGradientRow: $('bgGradientRow'), gradA: $('gradA'), gradB: $('gradB'),
  gradAngle: $('gradAngle'), gradAngleOut: $('gradAngleOut'),
  bgImageRow: $('bgImageRow'), btnBgImage: $('btnBgImage'), bgImageName: $('bgImageName'),
  featherRange: $('featherRange'), featherOut: $('featherOut'),
  shadowToggle: $('shadowToggle'), shadowControls: $('shadowControls'),
  shBlur: $('shBlur'), shDx: $('shDx'), shDy: $('shDy'), shOpacity: $('shOpacity'),
  fmtChips: $('fmtChips'), qualityRow: $('qualityRow'),
  qualityRange: $('qualityRange'), qualityOut: $('qualityOut'),
  btnDownload: $('btnDownload'), btnCopy: $('btnCopy'), btnResetMask: $('btnResetMask'),
  toasts: $('toasts'),
};

/* ---------------- estado ---------------- */

const state = {
  items: [],
  activeId: null,
  removed: new Set(),
  modelReady: false,
  busy: false,
  device: null,
  settings: {
    bg: { type: 'transparent', color: '#ffffff', colorA: '#3b82f6', colorB: '#9333ea', angle: 135, image: null, imageName: '' },
    shadow: { enabled: false, blur: 26, dx: 0, dy: 18, opacity: 0.45 },
    feather: 0,
    format: 'png',
    quality: 0.92,
  },
};

let idSeq = 0;
const active = () => state.items.find((i) => i.id === state.activeId) || null;

/* ---------------- worker + modelo ---------------- */

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const dlFiles = new Map(); // progreso de descarga por archivo

worker.onmessage = (e) => {
  const { type, id, payload } = e.data;
  if (type === 'progress') onModelProgress(payload);
  else if (type === 'ready') onModelReady(payload);
  else if (type === 'device') onDeviceChange(payload);
  else if (type === 'result') onResult(id, payload);
  else if (type === 'error') onProcessError(id, payload);
  else if (type === 'fatal') onModelFatal(payload);
};
worker.onerror = (e) => onModelFatal({ message: e.message || 'Error en el worker' });
worker.postMessage({ type: 'load' });

function onModelProgress(p) {
  if (!p.file) return;
  dlFiles.set(p.file, { loaded: p.loaded || 0, total: p.total || 0, done: p.status === 'done' });
  let loaded = 0;
  let total = 0;
  for (const f of dlFiles.values()) {
    loaded += f.done && f.total ? f.total : f.loaded;
    total += f.total;
  }
  if (total > 0) {
    const pct = Math.min(100, (loaded / total) * 100);
    el.modelBarFill.style.width = `${pct.toFixed(1)}%`;
    el.modelLabel.textContent = `Descargando modelo de IA · ${fmtMB(loaded)} / ${fmtMB(total)} MB (solo la primera vez)`;
  } else {
    el.modelLabel.textContent = 'Preparando modelo…';
  }
}

function onModelReady({ device }) {
  state.modelReady = true;
  state.device = device;
  el.modelChip.dataset.state = 'ready';
  el.modelLabel.textContent = device === 'webgpu'
    ? 'Modelo listo · WebGPU (GPU)'
    : 'Modelo listo · WASM (CPU)';
  if (device !== 'webgpu') {
    toast('Tu navegador no soporta WebGPU: se usará la CPU (más lento pero funciona igual).', 'warn');
  }
  processNext();
  updateStageStatus();
}

function onDeviceChange({ device }) {
  state.device = device;
  el.modelLabel.textContent = 'Modelo listo · WASM (CPU)';
}

function onModelFatal({ message }) {
  el.modelChip.dataset.state = 'error';
  el.modelLabel.textContent = 'Error al cargar el modelo — clic para reintentar';
  el.modelChip.style.cursor = 'pointer';
  el.modelChip.onclick = () => {
    el.modelChip.dataset.state = 'loading';
    el.modelLabel.textContent = 'Reintentando…';
    el.modelChip.onclick = null;
    worker.postMessage({ type: 'load' });
  };
  toast(`No se pudo cargar el modelo: ${message}`, 'error');
}

/* ---------------- añadir imágenes ---------------- */

async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && (f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(f.name)));
  if (!files.length) return;

  for (const file of files) {
    try {
      const bitmap = await createImageBitmap(file);
      const W = bitmap.width;
      const H = bitmap.height;

      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = W;
      originalCanvas.height = H;
      const octx = originalCanvas.getContext('2d', { willReadFrequently: true });
      octx.drawImage(bitmap, 0, 0);
      const imageData = octx.getImageData(0, 0, W, H);
      bitmap.close();

      const item = {
        id: `img${++idSeq}`,
        name: file.name || `imagen-${idSeq}`,
        status: 'pending',
        width: W,
        height: H,
        imageData,
        originalCanvas,
        baseMaskCanvas: null,
        strokesCanvas: null,
        strokesCtx: null,
        maskFull: null,
        subjectCanvas: null,
        finalCanvas: null,
        undoStack: [],
        redoStack: [],
        thumb: makeThumb(originalCanvas),
        error: null,
      };
      state.items.push(item);
      if (!state.activeId) setActive(item.id);

      if (Math.max(W, H) > 6000) {
        toast(`«${item.name}» es muy grande (${W}×${H}). Se procesará a resolución completa, pero puede consumir mucha memoria.`, 'warn');
      }
    } catch (err) {
      console.error(err);
      toast(`No se pudo leer «${file.name}». ¿Es un formato de imagen compatible?`, 'error');
    }
  }
  renderQueue();
  processNext();
  updateStageStatus();
}

/* ---------------- cola de procesamiento ---------------- */

function processNext() {
  if (!state.modelReady || state.busy) return;
  const next = state.items.find((i) => i.status === 'pending');
  if (!next) return;

  state.busy = true;
  next.status = 'processing';
  renderQueue();
  updateStageStatus();

  const copy = next.imageData.data.slice();
  worker.postMessage(
    { type: 'process', id: next.id, width: next.width, height: next.height, buffer: copy.buffer },
    [copy.buffer],
  );
}

function onResult(id, { width, height, buffer }) {
  state.busy = false;
  const item = state.items.find((i) => i.id === id);
  if (!item || state.removed.has(id)) { processNext(); return; }

  try {
    const maskData = new Uint8ClampedArray(buffer);
    item.baseMaskCanvas = buildBaseMaskCanvas(maskData, width, height, item.width, item.height);

    item.strokesCanvas = document.createElement('canvas');
    item.strokesCanvas.width = item.width;
    item.strokesCanvas.height = item.height;
    item.strokesCtx = item.strokesCanvas.getContext('2d', { willReadFrequently: true });

    recompose(item);
    item.status = 'done';
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.error = String(err?.message || err);
  }

  renderQueue();
  if (state.activeId === id) {
    editor.refreshLayers();
    updateActionAvailability();
  }
  updateStageStatus();
  processNext();
}

function onProcessError(id, { message }) {
  state.busy = false;
  const item = state.items.find((i) => i.id === id);
  if (item) {
    item.status = 'error';
    item.error = message;
    renderQueue();
    if (state.activeId === id) updateActionAvailability();
    toast(`Error al procesar «${item.name}»: ${message}`, 'error');
  }
  updateStageStatus();
  processNext();
}

/* recompone máscara → sujeto → resultado final */
function recompose(item) {
  rebuildMask(item, state.settings.feather);
  updateSubject(item);
  renderFinal(item, state.settings);
}

/* ---------------- UI de la cola ---------------- */

const STATUS_TEXT = { pending: 'En cola', processing: 'Procesando…', done: 'Listo', error: 'Error' };

function renderQueue() {
  el.queueList.replaceChildren();
  el.railEmpty.hidden = state.items.length > 0;

  for (const item of state.items) {
    const li = document.createElement('li');
    li.className = `qitem${item.id === state.activeId ? ' is-active' : ''}`;
    li.dataset.status = item.status;

    const img = document.createElement('img');
    img.className = 'qthumb';
    img.src = item.thumb;
    img.alt = '';

    const meta = document.createElement('div');
    meta.className = 'qmeta';
    const name = document.createElement('span');
    name.className = 'qname';
    name.textContent = item.name;
    const st = document.createElement('span');
    st.className = 'qstate';
    st.textContent = STATUS_TEXT[item.status];
    meta.append(name, st);

    const rm = document.createElement('button');
    rm.className = 'qremove';
    rm.type = 'button';
    rm.title = 'Quitar de la lista';
    rm.textContent = '×';
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeItem(item.id); });

    li.append(img, meta, rm);
    li.addEventListener('click', () => setActive(item.id));
    el.queueList.append(li);
  }

  el.btnZipAll.disabled = !state.items.some((i) => i.status === 'done');
}

function removeItem(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return;
  const wasProcessing = state.items[idx].status === 'processing';
  if (wasProcessing) state.removed.add(id); // el resultado se descartará al llegar
  state.items.splice(idx, 1);

  if (state.activeId === id) {
    const next = state.items[idx] || state.items[idx - 1] || null;
    setActive(next ? next.id : null);
  }
  renderQueue();
  updateStageStatus();
}

function setActive(id) {
  state.activeId = id;
  const item = active();
  editor.setItem(item);
  el.emptyState.hidden = !!item;
  el.imgInfo.textContent = item ? `${item.width} × ${item.height} px` : '';
  renderQueue();
  updateActionAvailability();
  updateStageStatus();
}

function updateActionAvailability() {
  const item = active();
  const ready = !!item && item.status === 'done';
  el.toolRestore.disabled = !ready;
  el.toolErase.disabled = !ready;
  el.toolCompare.disabled = !ready;
  el.brushRange.disabled = !ready;
  el.btnDownload.disabled = !ready;
  el.btnCopy.disabled = !ready;
  el.btnResetMask.disabled = !ready || (item.undoStack.length === 0 && item.redoStack.length === 0 && !item._edited);
  el.btnUndo.disabled = !ready || item.undoStack.length === 0;
  el.btnRedo.disabled = !ready || item.redoStack.length === 0;
  if (!ready && (editor.tool === 'restore' || editor.tool === 'erase')) setTool('pan');
}

function updateStageStatus() {
  const item = active();
  if (item && item.status === 'processing') {
    el.stageStatusText.textContent = 'Recortando con IA…';
    el.stageStatus.hidden = false;
  } else if (item && item.status === 'pending') {
    el.stageStatusText.textContent = state.modelReady ? 'En cola…' : 'Esperando al modelo…';
    el.stageStatus.hidden = false;
  } else if (item && item.status === 'error') {
    el.stageStatusText.textContent = `Error: ${item.error || 'desconocido'}`;
    el.stageStatus.hidden = false;
  } else {
    el.stageStatus.hidden = true;
  }
}

/* ---------------- editor ---------------- */

const editor = new Editor({
  stage: el.stage,
  transformEl: el.stageTransform,
  stackEl: el.canvasStack,
  divider: el.compareDivider,
  cursorEl: el.brushCursor,
  onStroke: (stroke) => {
    const item = active();
    if (item && item.status === 'done') applyStroke(item, stroke);
  },
  onTransform: (s) => { el.zoomLabel.textContent = `${Math.round(s * 100)}%`; },
});

const HINTS = {
  pan: 'Rueda: zoom · arrastra para mover · C: comparar',
  restore: 'Pinta lo que la IA borró de más · [ y ] cambian el tamaño',
  erase: 'Pinta los restos de fondo que queden · [ y ] cambian el tamaño',
};

function setTool(tool) {
  editor.setTool(tool);
  for (const btn of [el.toolPan, el.toolRestore, el.toolErase]) {
    btn.classList.toggle('is-active', btn.dataset.tool === tool);
  }
  el.editHint.textContent = HINTS[tool] || '';
}

el.toolPan.addEventListener('click', () => setTool('pan'));
el.toolRestore.addEventListener('click', () => setTool('restore'));
el.toolErase.addEventListener('click', () => setTool('erase'));

el.toolCompare.addEventListener('click', () => {
  editor.setCompare(!editor.compare);
  el.toolCompare.classList.toggle('is-active', editor.compare);
});

el.brushRange.addEventListener('input', () => {
  editor.setBrushSize(Number(el.brushRange.value));
  el.brushOut.textContent = `${el.brushRange.value}px`;
});

el.zoomIn.addEventListener('click', () => editor.zoomBy(1.25));
el.zoomOut.addEventListener('click', () => editor.zoomBy(0.8));
el.zoomFit.addEventListener('click', () => editor.fit());

/* ---------------- pincel: aplicar, deshacer, rehacer ---------------- */

function strokeBBox(stroke, item) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const r = stroke.size / 2 + 2;
  const x = Math.max(0, Math.floor(minX - r));
  const y = Math.max(0, Math.floor(minY - r));
  const x2 = Math.min(item.width, Math.ceil(maxX + r));
  const y2 = Math.min(item.height, Math.ceil(maxY + r));
  if (x2 - x <= 0 || y2 - y <= 0) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

function drawStroke(ctx, stroke) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = stroke.mode === 'restore' ? '#ffffff' : '#000000';
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function applyStroke(item, stroke) {
  const rect = strokeBBox(stroke, item);
  if (!rect) return;
  const before = item.strokesCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
  item.undoStack.push({ rect, data: before });
  if (item.undoStack.length > 20) item.undoStack.shift();
  item.redoStack.length = 0;
  item._edited = true;

  drawStroke(item.strokesCtx, stroke);
  recompose(item);
  updateActionAvailability();
}

function undo(item) {
  const u = item.undoStack.pop();
  if (!u) return;
  const cur = item.strokesCtx.getImageData(u.rect.x, u.rect.y, u.rect.w, u.rect.h);
  item.redoStack.push({ rect: u.rect, data: cur });
  item.strokesCtx.putImageData(u.data, u.rect.x, u.rect.y);
  recompose(item);
  updateActionAvailability();
}

function redo(item) {
  const r = item.redoStack.pop();
  if (!r) return;
  const cur = item.strokesCtx.getImageData(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
  item.undoStack.push({ rect: r.rect, data: cur });
  item.strokesCtx.putImageData(r.data, r.rect.x, r.rect.y);
  recompose(item);
  updateActionAvailability();
}

el.btnUndo.addEventListener('click', () => { const i = active(); if (i) undo(i); });
el.btnRedo.addEventListener('click', () => { const i = active(); if (i) redo(i); });

el.btnResetMask.addEventListener('click', () => {
  const item = active();
  if (!item || item.status !== 'done') return;
  item.strokesCtx.clearRect(0, 0, item.width, item.height);
  item.undoStack.length = 0;
  item.redoStack.length = 0;
  item._edited = false;
  recompose(item);
  updateActionAvailability();
  toast('Recorte restablecido al resultado original de la IA.');
});

/* ---------------- ajustes: fondo, bordes, sombra ---------------- */

let rafPending = false;
function rerenderActive() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const item = active();
    if (item && item.status === 'done') renderFinal(item, state.settings);
  });
}

el.bgChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bg]');
  if (!btn) return;
  state.settings.bg.type = btn.dataset.bg;
  for (const b of el.bgChips.querySelectorAll('.pick')) b.classList.toggle('is-active', b === btn);
  el.bgColorRow.hidden = btn.dataset.bg !== 'color';
  el.bgGradientRow.hidden = btn.dataset.bg !== 'gradient';
  el.bgImageRow.hidden = btn.dataset.bg !== 'image';
  if (btn.dataset.bg === 'image' && !state.settings.bg.image) el.bgImageInput.click();
  rerenderActive();
});

el.bgColor.addEventListener('input', () => { state.settings.bg.color = el.bgColor.value; rerenderActive(); });
el.gradA.addEventListener('input', () => { state.settings.bg.colorA = el.gradA.value; rerenderActive(); });
el.gradB.addEventListener('input', () => { state.settings.bg.colorB = el.gradB.value; rerenderActive(); });
el.gradAngle.addEventListener('input', () => {
  state.settings.bg.angle = Number(el.gradAngle.value);
  el.gradAngleOut.textContent = `${el.gradAngle.value}°`;
  rerenderActive();
});

el.btnBgImage.addEventListener('click', () => el.bgImageInput.click());
el.bgImageInput.addEventListener('change', async () => {
  const file = el.bgImageInput.files?.[0];
  el.bgImageInput.value = '';
  if (!file) return;
  try {
    state.settings.bg.image = await createImageBitmap(file);
    state.settings.bg.imageName = file.name;
    el.bgImageName.textContent = file.name;
    rerenderActive();
  } catch {
    toast('No se pudo leer la imagen de fondo.', 'error');
  }
});

el.featherRange.addEventListener('input', () => {
  el.featherOut.textContent = `${el.featherRange.value}px`;
});
el.featherRange.addEventListener('change', () => {
  state.settings.feather = Number(el.featherRange.value);
  const item = active();
  if (item && item.status === 'done') recompose(item);
});

el.shadowToggle.addEventListener('change', () => {
  state.settings.shadow.enabled = el.shadowToggle.checked;
  el.shadowControls.hidden = !el.shadowToggle.checked;
  rerenderActive();
});
for (const [input, key, scale] of [
  [el.shBlur, 'blur', 1], [el.shDx, 'dx', 1], [el.shDy, 'dy', 1], [el.shOpacity, 'opacity', 0.01],
]) {
  input.addEventListener('input', () => {
    state.settings.shadow[key] = Number(input.value) * scale;
    rerenderActive();
  });
}

/* ---------------- exportación ---------------- */

el.fmtChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-fmt]');
  if (!btn) return;
  state.settings.format = btn.dataset.fmt;
  for (const b of el.fmtChips.querySelectorAll('.pick')) b.classList.toggle('is-active', b === btn);
  el.qualityRow.hidden = btn.dataset.fmt === 'png';
});
el.qualityRange.addEventListener('input', () => {
  state.settings.quality = Number(el.qualityRange.value) / 100;
  el.qualityOut.textContent = el.qualityRange.value;
});

function outName(item, fmt) {
  const base = item.name.replace(/\.[^.]+$/, '') || 'imagen';
  return `${base}-pixelpeel.${FORMAT_EXT[fmt]}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

el.btnDownload.addEventListener('click', async () => {
  const item = active();
  if (!item || item.status !== 'done') return;
  try {
    const { format, quality } = state.settings;
    const blob = await exportBlob(item, state.settings, format, quality);
    saveBlob(blob, outName(item, format));
  } catch (err) {
    toast(`No se pudo exportar: ${err.message}`, 'error');
  }
});

el.btnCopy.addEventListener('click', async () => {
  const item = active();
  if (!item || item.status !== 'done') return;
  try {
    const blob = await exportBlob(item, state.settings, 'png', 1);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Imagen copiada al portapapeles (PNG).');
  } catch (err) {
    toast('Tu navegador no permitió copiar la imagen. Usa «Descargar imagen».', 'error');
  }
});

el.btnZipAll.addEventListener('click', async () => {
  const done = state.items.filter((i) => i.status === 'done');
  if (!done.length) return;
  el.btnZipAll.disabled = true;
  const prev = el.btnZipAll.textContent;
  el.btnZipAll.textContent = 'Empaquetando…';
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    const { format, quality } = state.settings;
    const used = new Set();
    for (const item of done) {
      const blob = await exportBlob(item, state.settings, format, quality);
      let name = outName(item, format);
      while (used.has(name)) name = name.replace(/(\.[^.]+)$/, `-${item.id}$1`);
      used.add(name);
      zip.file(name, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveBlob(zipBlob, 'pixelpeel.zip');
    toast(`${done.length} ${done.length === 1 ? 'imagen exportada' : 'imágenes exportadas'} en el .zip.`);
  } catch (err) {
    console.error(err);
    toast('No se pudo generar el .zip (¿sin conexión para cargar el empaquetador?).', 'error');
  } finally {
    el.btnZipAll.textContent = prev;
    el.btnZipAll.disabled = false;
    renderQueue();
  }
});

/* ---------------- entrada: selector, arrastrar, pegar ---------------- */

el.btnAdd.addEventListener('click', () => el.fileInput.click());
el.btnPick.addEventListener('click', () => el.fileInput.click());
el.emptyState.addEventListener('click', (e) => {
  if (e.target === el.emptyState || e.target.closest('.peel-illo, h1, .hint')) el.fileInput.click();
});
el.fileInput.addEventListener('change', () => {
  addFiles(el.fileInput.files);
  el.fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  el.dropHint.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropHint.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropHint.hidden = true;
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

window.addEventListener('paste', (e) => {
  const files = [];
  for (const it of e.clipboardData?.items || []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    addFiles(files);
    toast(`${files.length === 1 ? 'Imagen pegada' : `${files.length} imágenes pegadas`} desde el portapapeles.`);
  }
});

/* ---------------- atajos de teclado ---------------- */

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const item = active();
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (item && item.status === 'done') (e.shiftKey ? redo : undo)(item);
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (item && item.status === 'done') redo(item);
    return;
  }
  if (mod) return;

  switch (e.key) {
    case 'v': case 'V': setTool('pan'); break;
    case 'b': case 'B': if (!el.toolRestore.disabled) setTool('restore'); break;
    case 'e': case 'E': if (!el.toolErase.disabled) setTool('erase'); break;
    case 'c': case 'C': if (!el.toolCompare.disabled) el.toolCompare.click(); break;
    case '[': stepBrush(-8); break;
    case ']': stepBrush(8); break;
    case '+': case '=': editor.zoomBy(1.25); break;
    case '-': editor.zoomBy(0.8); break;
    case '0': editor.fit(); break;
    default: break;
  }
});

function stepBrush(d) {
  const v = Math.min(300, Math.max(4, Number(el.brushRange.value) + d));
  el.brushRange.value = v;
  editor.setBrushSize(v);
  el.brushOut.textContent = `${v}px`;
}

/* ---------------- utilidades ---------------- */

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(0);
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.dataset.kind = kind;
  t.textContent = msg;
  el.toasts.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4500);
}

/* ---------------- arranque ---------------- */

setTool('pan');
el.editHint.textContent = HINTS.pan;
