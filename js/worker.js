/* ============================================================
   PixelPeel — Web Worker de inferencia
   Carga RMBG-1.4 con Transformers.js y devuelve la MÁSCARA
   (1 canal, 0–255) a resolución del modelo. El escalado al
   tamaño original y la aplicación al canal alpha ocurren en
   el hilo principal (ver compositor.js).
   ============================================================ */

// Versión fijada de la rama v3 (validada para este flujo).
// Si quieres actualizar, verifica primero que `image-segmentation`
// con briaai/RMBG-1.4 siga devolviendo `output[0].mask`.
import {
  pipeline,
  env,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true; // cachear el modelo (~180 MB) tras la primera descarga

const MODEL_ID = 'briaai/RMBG-1.4';

let segmenter = null;
let device = null;
let loading = null;

/* ---------- utilidades ---------- */

function post(type, payload, transfer) {
  self.postMessage({ type, ...payload }, transfer || []);
}

function cleanProgress(p) {
  // Los eventos de progreso traen campos extra; enviamos solo lo clonable/útil.
  return {
    status: p.status,
    file: p.file || '',
    loaded: p.loaded || 0,
    total: p.total || 0,
    progress: p.progress || 0,
  };
}

async function buildPipeline(dev) {
  return pipeline('image-segmentation', MODEL_ID, {
    device: dev,
    dtype: 'fp32', // NO cuantizar: int8 degrada bordes y pelo
    progress_callback: (p) => post('progress', { payload: cleanProgress(p) }),
  });
}

async function loadModel() {
  if (segmenter) return;
  if (loading) return loading;

  loading = (async () => {
    const wantsGpu = typeof self.navigator !== 'undefined' && !!self.navigator.gpu;
    if (wantsGpu) {
      try {
        segmenter = await buildPipeline('webgpu');
        device = 'webgpu';
      } catch (err) {
        console.warn('[PixelPeel] WebGPU no disponible, usando WASM (CPU):', err);
      }
    }
    if (!segmenter) {
      segmenter = await buildPipeline('wasm');
      device = 'wasm';
    }
    post('ready', { payload: { device } });
  })();

  try {
    await loading;
  } catch (err) {
    loading = null;
    post('fatal', { payload: { message: String(err?.message || err) } });
    throw err;
  }
}

/* ---------- extracción robusta de la máscara ----------
   `image-segmentation` con RMBG-1.4 devuelve [{ mask: RawImage }]
   (1 canal). Por si la API varía entre versiones menores, también
   aceptamos un RawImage directo (1 o 4 canales, en cuyo caso el
   alpha es la máscara). */
function extractMask(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first) throw new Error('El modelo no devolvió resultados');

  const img = first.mask || first;
  if (!img || !img.data || !img.width) {
    throw new Error('Formato de salida del modelo no reconocido');
  }

  const { width, height, channels = 1, data } = img;
  const out = new Uint8ClampedArray(width * height);

  if (channels === 1) {
    out.set(data.subarray ? data.subarray(0, out.length) : data);
  } else if (channels === 4) {
    for (let p = 0, i = 3; p < out.length; p++, i += 4) out[p] = data[i];
  } else {
    for (let p = 0, i = 0; p < out.length; p++, i += channels) out[p] = data[i];
  }
  return { data: out, width, height };
}

/* ---------- inferencia ---------- */

async function process(msg) {
  const { id, width, height, buffer } = msg;
  await loadModel();

  const pixels = new Uint8ClampedArray(buffer);
  const image = new RawImage(pixels, width, height, 4);

  let output;
  try {
    output = await segmenter(image);
  } catch (err) {
    // Si WebGPU falla en tiempo de inferencia, reintentar una vez en WASM.
    if (device === 'webgpu') {
      console.warn('[PixelPeel] Fallo en WebGPU durante inferencia, cambiando a WASM:', err);
      segmenter = await buildPipeline('wasm');
      device = 'wasm';
      post('device', { payload: { device } });
      output = await segmenter(image);
    } else {
      throw err;
    }
  }

  const mask = extractMask(output);
  post(
    'result',
    { id, payload: { width: mask.width, height: mask.height, buffer: mask.data.buffer } },
    [mask.data.buffer],
  );
}

/* ---------- mensajes ---------- */

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await loadModel();
    } else if (msg.type === 'process') {
      await process(msg);
    }
  } catch (err) {
    console.error('[PixelPeel worker]', err);
    post('error', { id: msg.id, payload: { message: String(err?.message || err) } });
  }
};
