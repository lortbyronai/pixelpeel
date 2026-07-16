# PixelPeel — Cómo funciona (documento técnico)

Explicación de la arquitectura y el pipeline de PixelPeel, un eliminador de fondos que corre 100% en el navegador, sin servidor y sin build step.

---

## 1. Visión general

```
┌─────────────────────────── Navegador ────────────────────────────┐
│                                                                  │
│  Hilo principal (main.js)              Web Worker (worker.js)    │
│  ┌──────────────────────┐   postMessage  ┌────────────────────┐  │
│  │ UI · cola · editor   │ ──── píxeles ─▶│ Transformers.js    │  │
│  │ compositor · export  │ ◀─── máscara ──│ RMBG-1.4 (ONNX)    │  │
│  └──────────────────────┘  (transferable)│ WebGPU → WASM      │  │
│                                          └────────────────────┘  │
│  Red: solo la primera vez, para descargar el modelo (~180 MB     │
│  desde Hugging Face) y el runtime WASM (desde jsDelivr).         │
│  Las imágenes del usuario NUNCA salen del equipo.                │
└──────────────────────────────────────────────────────────────────┘
```

- **Sin build:** vanilla JS con módulos ES nativos. No hay `npm install` ni bundler.
- **Sin servidor de inferencia:** el modelo corre en el dispositivo del usuario.
- **Privacidad estructural:** no es una promesa de política, es arquitectura — no existe endpoint al que subir imágenes.

## 2. Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Estructura de la UI (español) |
| `css/style.css` | Tema oscuro de editor; el color codifica significado: verde = conservar, magenta = borrar |
| `js/main.js` | Orquestación: estado, cola por lotes, ajustes, exportación, atajos de teclado |
| `js/worker.js` | Inferencia: Transformers.js + RMBG-1.4 dentro de un Web Worker |
| `js/compositor.js` | Pipeline de calidad: máscara → canal alpha → fondo/sombra → export |
| `js/editor.js` | Viewport: zoom/pan con CSS transform, pincel con overlay, comparador |
| `_headers` / `netlify.toml` | Headers COOP/COEP para hosting estático |

## 3. El modelo y la inferencia (`worker.js`)

- **Modelo:** `briaai/RMBG-1.4`, un modelo de *segmentación de objeto saliente* (salient object detection). Dada una imagen, produce una máscara de 1 canal (0–255) donde blanco = sujeto y negro = fondo. No es chroma key: no le importa el color del fondo, busca "lo principal" de la escena.
- **Runtime:** [Transformers.js](https://huggingface.co/docs/transformers.js) v3.8.1, que ejecuta el modelo ONNX con **ONNX Runtime Web**.
- **`dtype: fp32`** — deliberadamente sin cuantizar. La cuantización int8 reduce el tamaño y acelera, pero degrada los bordes finos (pelo, pelusa), que es justo donde se juzga la calidad de un recorte.
- **Aceleración con degradación elegante:**
  1. Si `navigator.gpu` existe → se intenta **WebGPU** (GPU, rápido).
  2. Si la construcción del pipeline falla → **WASM** (CPU).
  3. Si WebGPU falla *a mitad de una inferencia* (drivers, pérdida de contexto), el worker reconstruye el pipeline en WASM y reintenta esa misma imagen — el usuario solo nota que tardó más.
- **Caché:** `env.useBrowserCache = true` → los ~180 MB del modelo quedan en la Cache API del navegador. Las visitas siguientes cargan casi al instante. El progreso de descarga se reporta por archivo (`progress_callback`) y la UI lo agrega para mostrar MB totales.
- **Extracción defensiva de la máscara:** la salida esperada es `[{ mask: RawImage }]` con 1 canal, pero `extractMask()` también acepta un `RawImage` directo de 1, 4 o N canales (tomando el alpha o el primer canal). Esto permite cambiar `MODEL_ID` por otros modelos de segmentación sin tocar el resto de la app.

### ¿Por qué un Web Worker?

La inferencia (especialmente en WASM/CPU) puede tardar segundos. En el hilo principal congelaría la UI: no se podría hacer zoom, ni añadir más imágenes, ni ver el progreso. En el worker, la app sigue fluida durante todo el proceso.

### Comunicación con transferables

Los píxeles (ancho × alto × 4 bytes) y la máscara viajan entre hilos como `ArrayBuffer` **transferidos**, no copiados:

```js
worker.postMessage({ type: 'process', id, width, height, buffer }, [buffer]);
```

Para una foto de 4000×3000 son ~48 MB por dirección; transferir en vez de clonar evita duplicar esa memoria y el coste de la copia.

## 4. El pipeline de calidad (`compositor.js`)

El principio central: **los canales RGB originales nunca se tocan**. Solo se escribe el canal alpha. Cero pérdida de color y cero pérdida de resolución, sin importar cuántas veces se reprocese o ajuste.

Etapas, por imagen:

1. **`buildBaseMaskCanvas`** — la máscara del modelo (~1024×1024) se dibuja como escala de grises en un canvas pequeño y se escala al tamaño real de la foto con `imageSmoothingQuality: 'high'` (interpolación bicúbica del navegador). Resultado: máscara base a resolución original.
2. **`rebuildMask`** — compone la máscara final: máscara base (con `blur()` opcional si hay *feather*) + el canvas de trazos manuales encima. Los trazos del usuario (blanco = restaurar, negro = borrar) se dibujan **sin** suavizado: el control manual debe ser predecible y nítido.
3. **`updateSubject`** — copia los píxeles RGBA originales y escribe la máscara en el canal alpha: `out[i+3] = mask[p]` (multiplicando si el PNG original ya tenía transparencia). Aquí ocurre el "recorte" real.
4. **`renderFinal`** — pinta el fondo elegido (transparente / color / degradado / imagen en modo *cover*), aplica la sombra si está activa (con `filter: drop-shadow` **escalado por `max(W,H)/1600`** para que se vea igual en una foto de 800 px que en una de 6000 px) y dibuja el sujeto encima.
5. **`exportBlob`** — `canvas.toBlob()` en PNG/WebP/JPG. JPG no soporta transparencia, así que se aplana sobre blanco antes.

## 5. Orquestación y estado (`main.js`)

- **Cola por lotes:** cada imagen es un *item* con máquina de estados `pending → processing → done | error`. Se procesan **en serie** (una inferencia a la vez): paralelizar multiplicaría el pico de memoria y en la práctica no acelera (GPU/CPU ya saturadas por una inferencia).
- **Cada item conserva:** `imageData` original, canvas de máscara base, canvas de trazos, pilas de undo/redo (20 pasos, guardando solo el **bounding box** del trazo, no el canvas entero), y los canvas derivados (sujeto, final).
- **Undo/redo quirúrgico:** antes de aplicar un trazo se captura `getImageData` solo del rectángulo afectado. Deshacer restaura ese parche. Esto mantiene el coste de memoria proporcional al trazo, no al tamaño de la foto.
- **Entradas:** selector de archivos, drag & drop global (con contador de profundidad para el hint) y pegado con `Ctrl+V` desde el portapapeles.
- **Item borrado durante el procesamiento:** se marca en un `Set` y su resultado se descarta al llegar (evita resucitar items eliminados).

## 6. El editor (`editor.js`)

- **Zoom/pan sin repintar:** los canvas se muestran a resolución original y se escalan solo visualmente con `transform: translate(...) scale(...)`. Zoom y pan son operaciones de compositor del navegador (baratas), no re-renders.
- **Pincel:** mientras arrastras, el trazo se previsualiza tintado (verde/magenta) en un canvas overlay. Al soltar, el trazo se aplica a la máscara real y el overlay se limpia. Coordenadas de pantalla → imagen vía `getBoundingClientRect` del canvas de referencia.
- **Comparador:** el canvas original se superpone al resultado con `clip-path: inset(...)` controlado por el divisor arrastrable. No hay copia de píxeles: es puro recorte visual CSS.

## 7. Hosting y headers COOP/COEP

`_headers` y `netlify.toml` configuran:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Esto habilita `SharedArrayBuffer`, que ONNX Runtime Web usa para **WASM multihilo** — acelera notablemente la CPU cuando no hay WebGPU. Se usa `credentialless` (y no `require-corp`) porque la app carga recursos de terceros (jsDelivr, Hugging Face, Google Fonts) que no envían `Cross-Origin-Resource-Policy`. Si estos headers faltan, la app funciona igual pero el fallback de CPU es más lento (un solo hilo).

## 8. Decisiones de diseño, en resumen

| Decisión | Alternativa descartada | Por qué |
| --- | --- | --- |
| Inferencia en el navegador | API en servidor | Privacidad estructural, costo cero por imagen, sin backend que mantener |
| Máscara → solo canal alpha | Recomponer la imagen | Cero degradación de color/resolución del original |
| fp32 sin cuantizar | int8 (más rápido/pequeño) | Calidad de bordes en pelo y detalles finos |
| Procesamiento en serie | Paralelo | Pico de memoria acotado; el hardware ya está saturado por una inferencia |
| Web Worker | Inferencia en hilo principal | UI fluida durante los segundos de inferencia |
| Transferables | postMessage con copia | Evita duplicar decenas de MB por imagen |
| Undo por bounding box | Snapshot del canvas completo | Memoria proporcional al trazo, no a la foto |
| Vanilla JS + ES modules | Framework + bundler | Nada que compilar, nada que romperse, deploy = copiar carpeta |

## 9. Licencia del modelo

`briaai/RMBG-1.4` es *source-available* de BRIA AI, **solo uso no comercial**. Para uso comercial: licencia con BRIA, o cambiar `MODEL_ID` en `js/worker.js` por una alternativa permisiva (ISNet, U²-Net, BiRefNet — verificar licencia de cada una). El código de la app no impone restricciones.
