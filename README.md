# PixelPeel

Professional-grade background remover that runs **100% in the user's browser**. No server, zero cost per image, and privacy by design: your images never leave your machine — the only network traffic you'll see is the one-time model download from Hugging Face and the WASM runtime from jsDelivr.

> 🇪🇸 Documentación en español: [README.es.md](README.es.md) · [Cómo funciona (técnico)](COMO-FUNCIONA-TECNICO.md) · [Cómo funciona (para todos)](COMO-FUNCIONA-PARA-TODOS.md) · [Guía de imágenes IA](GUIA-IMAGENES-IA.md) · [Ideas y roadmap](IDEAS-Y-ROADMAP.md)

## Features

| Feature | Details |
| --- | --- |
| Batch processing | Queue with per-image status and thumbnail; images are processed sequentially and automatically |
| Refinement brush | **Restore** (green) recovers what the AI erased; **Erase** (magenta) removes leftover background. Undo/redo (20 steps) and "reset to AI cutout" |
| Before/after comparator | Draggable divider over the image |
| Replacement backgrounds | Transparent, solid color, gradient (with angle), or your own image (*cover* fit) |
| Automatic shadow | Blur, distance, lateral offset and opacity; scaled to each photo's resolution so it looks the same at 800px or 6000px |
| Edge feathering | Global 0–12 px feather (only affects the AI mask; your manual strokes stay crisp) |
| Export | PNG (transparency), WebP, JPG (flattened on white) with quality control; copy PNG to clipboard; **download everything as .zip** |
| Input | File picker, drag & drop anywhere, or paste with `Ctrl+V` |
| Zoom & pan | Mouse wheel, buttons, `space + drag`, middle mouse button |
| Status indicators | Model chip with download progress in MB and active device (WebGPU / WASM) |

**Shortcuts:** `V` move · `B` restore · `E` erase · `C` compare · `[` `]` brush size · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `+` `−` `0` zoom.

## Quick start (run locally)

ES modules and the Web Worker must be served over HTTP (double-clicking `index.html` won't work).

```bash
# option 1 (Node)
npx serve .

# option 2 (Python)
python3 -m http.server 8080
```

Open `http://localhost:8080`. On first visit the model (~180 MB) is downloaded with a progress bar; afterwards it stays in the browser cache and loads almost instantly.

There is no build step, no `npm install`, and no bundler — it's vanilla JavaScript with native ES modules.

## Usage

1. **Add images:** drag & drop them anywhere on the page, click *Añadir*, or paste with `Ctrl+V`. You can add several at once; they queue up and process one by one.
2. **Wait for the cutout:** the first image takes longer (model download + warm-up); the rest are much faster.
3. **Refine if needed:** use the **Restore** brush (green, `B`) to bring back anything the AI removed by mistake, and **Erase** (magenta, `E`) to clean up leftover background. `C` toggles the before/after comparator.
4. **Pick a background:** transparent, solid color, gradient, or an image of your own. Optionally enable the automatic shadow.
5. **Export:** PNG/WebP/JPG per image, copy to clipboard, or download the whole batch as a .zip.

## Deploy (static hosting)

Drag the folder into **Cloudflare Pages** or **Netlify**, or push it to **GitHub Pages**. There is no build step.

`_headers` (Cloudflare Pages / Netlify) and `netlify.toml` are included with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These headers enable `SharedArrayBuffer` → **multithreaded WASM**, which significantly speeds up the CPU fallback when WebGPU is unavailable. `credentialless` (more permissive than `require-corp`) is used because the app loads resources from jsDelivr, Hugging Face and Google Fonts. If some external resource stops loading on your host, remove these headers: the app still works, it just loses multithreading on CPU.

> Note: GitHub Pages does not support custom headers, so the CPU fallback runs single-threaded there. WebGPU users are unaffected.

## How it's built

### Architecture

```
┌─────────────────────────── Browser ──────────────────────────────┐
│                                                                  │
│  Main thread (main.js)               Web Worker (worker.js)      │
│  ┌──────────────────────┐  postMessage  ┌────────────────────┐   │
│  │ UI · queue · editor  │ ─── pixels ──▶│ Transformers.js    │   │
│  │ compositor · export  │ ◀── mask ─────│ RMBG-1.4 (ONNX)    │   │
│  └──────────────────────┘ (transferable)│ WebGPU → WASM      │   │
│                                         └────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

| File | Responsibility |
| --- | --- |
| `index.html` | UI structure (Spanish) |
| `css/style.css` | Dark editor theme; color encodes meaning: green = keep, magenta = erase |
| `js/main.js` | Orchestration: state, batch queue, settings, export, keyboard shortcuts |
| `js/worker.js` | Inference: Transformers.js + RMBG-1.4 inside a Web Worker (webgpu→wasm, fp32) |
| `js/compositor.js` | Quality pipeline: mask → alpha channel of the original → background/shadow → export |
| `js/editor.js` | Viewport: zoom/pan via CSS transform, brush with overlay preview, comparator |

### The model

- **Model:** [`briaai/RMBG-1.4`](https://huggingface.co/briaai/RMBG-1.4), a *salient object segmentation* model, running via [Transformers.js](https://huggingface.co/docs/transformers.js) `v3.8.1` (ONNX Runtime Web).
- **`dtype: fp32`** — deliberately unquantized: int8 would be smaller and faster but degrades fine edges (hair, fuzz), which is exactly where cutout quality is judged.
- **Acceleration with graceful degradation:** WebGPU if available, automatic fallback to WASM (CPU) — even if WebGPU fails *mid-inference*, the worker rebuilds the pipeline on WASM and retries the same image.
- **Caching:** `env.useBrowserCache = true` — the ~180 MB model is downloaded once and stored in the browser's Cache API.

### The quality pipeline

The core principle: **the original RGB channels are never touched.** The model's mask (~1024²) is upscaled to the photo's real size with high-quality interpolation and written **only into the alpha channel** of the original pixels. Zero color loss, zero resolution loss, no matter how many times you tweak settings or re-composite.

Other design decisions worth knowing:

- **Web Worker for inference** — the UI stays fluid during the seconds an inference takes.
- **Transferables** — pixel and mask `ArrayBuffer`s are *transferred* between threads, not copied (a 4000×3000 photo is ~48 MB per direction).
- **Sequential queue** — one inference at a time: bounded memory peak, and the GPU/CPU is already saturated by a single inference anyway.
- **Surgical undo** — each brush stroke stores only the bounding-box patch it affected, not a full-canvas snapshot.
- **Zoom/pan via CSS transform** — canvases are shown at native resolution and scaled visually; zooming never re-renders pixels.

## ⚠️ Model license (important)

`briaai/RMBG-1.4` is *source-available* by **BRIA AI** and licensed for **non-commercial use only**. For commercial use you must obtain a license from BRIA (see the [model card](https://huggingface.co/briaai/RMBG-1.4)).

If your project is commercial and you don't want to license it, change `MODEL_ID` in `js/worker.js` to a permissively-licensed alternative compatible with Transformers.js (e.g. ISNet/U²-Net-based models, or BiRefNet — **check each model's license**). The worker already extracts the mask defensively (it accepts a 1-channel `{mask}` or a `RawImage` with alpha), so many segmentation models work without touching the rest of the app.

The app code itself imposes no restrictions.

## Troubleshooting

- **Model chip says "WASM (CPU)":** your browser doesn't expose WebGPU (or not inside Workers). Everything still works, just slower. Recent Chrome/Edge support it.
- **First image takes very long:** that's the model download + initial compilation. Subsequent images are much faster.
- **"Copy to clipboard" fails:** the Clipboard API requires a secure context (HTTPS or `localhost`).
- **Huge photos (>6000 px):** processed at full resolution, but memory usage grows quickly in large batches; the app warns you when adding them.
- **Upgrading Transformers.js:** before bumping the version in `js/worker.js`, verify that `pipeline('image-segmentation', 'briaai/RMBG-1.4')` still returns the mask in the same shape (the defensive extraction in `worker.js` covers reasonable variations).

## Documentation (Spanish)

- [README.es.md](README.es.md) — this README in Spanish
- [COMO-FUNCIONA-TECNICO.md](COMO-FUNCIONA-TECNICO.md) — technical deep-dive into the architecture
- [COMO-FUNCIONA-PARA-TODOS.md](COMO-FUNCIONA-PARA-TODOS.md) — non-technical explanation for everyone
- [GUIA-IMAGENES-IA.md](GUIA-IMAGENES-IA.md) — how to prompt AI image generators (ChatGPT) so cutouts come out perfect
- [IDEAS-Y-ROADMAP.md](IDEAS-Y-ROADMAP.md) — roadmap and ideas for what to build next with in-browser AI
