# PixelPeel

Eliminador de fondos de nivel profesional que corre **100% en el navegador del usuario**. Cero servidor, cero costo por imagen y privacidad por diseño: la imagen nunca se transmite — la única red que verás son las descargas del modelo desde Hugging Face y del runtime WASM desde jsDelivr.

- **Modelo:** `briaai/RMBG-1.4` vía [Transformers.js](https://huggingface.co/docs/transformers.js) `v3.8.1` (ONNX Runtime Web), `dtype: fp32` (sin cuantizar, para no degradar bordes ni pelo).
- **Aceleración:** WebGPU con fallback automático a WASM (CPU), incluso si WebGPU falla a mitad de una inferencia.
- **Calidad:** la máscara del modelo (~1024²) se escala con interpolación de alta calidad al tamaño real y se escribe **solo en el canal alpha** de los píxeles originales. Los canales RGB nunca se tocan → cero pérdida de color/resolución.
- **Caché:** el modelo (~180 MB) se descarga una vez y queda cacheado (`env.useBrowserCache = true`). Visitas siguientes: carga casi instantánea.
- **Sin build:** vanilla JS con módulos ES. No hay `npm install`, no hay bundler, nada que se rompa.

## Funcionalidades

| Función | Detalle |
| --- | --- |
| Procesamiento por lotes | Cola con estados y miniatura por imagen; se procesan en serie automáticamente |
| Pincel de refinamiento | **Restaurar** (verde) recupera lo que la IA borró; **Borrar** (magenta) quita restos de fondo. Con deshacer/rehacer (20 pasos) y "restablecer al recorte de la IA" |
| Comparador antes/después | Divisor arrastrable sobre la imagen |
| Fondos de reemplazo | Transparente, color sólido, degradado (con ángulo) o imagen propia (ajuste *cover*) |
| Sombra automática | Difusión, distancia, lateral y opacidad; escalada a la resolución de cada foto para verse igual en 800px que en 6000px |
| Suavizado de bordes | *Feather* global 0–12 px (solo afecta la máscara de la IA; tus trazos manuales quedan nítidos) |
| Exportación | PNG (transparencia), WebP, JPG (aplanado sobre blanco) con control de calidad; copiar PNG al portapapeles; **descargar todo en .zip** |
| Entrada | Selector de archivos, arrastrar y soltar en cualquier parte, o pegar con `Ctrl+V` |
| Zoom y pan | Rueda del ratón, botones, `espacio + arrastrar`, botón central |
| Indicadores | Chip de estado del modelo con progreso de descarga en MB y dispositivo activo (WebGPU / WASM) |

**Atajos:** `V` mover · `B` restaurar · `E` borrar · `C` comparar · `[` `]` tamaño del pincel · `Ctrl+Z` / `Ctrl+Shift+Z` deshacer/rehacer · `+` `−` `0` zoom.

## Cómo correrlo en local

Los módulos ES y el Web Worker requieren servirse por HTTP (no funciona abriendo `index.html` con doble clic).

```bash
# opción 1 (Node)
npx serve .

# opción 2 (Python)
python3 -m http.server 8080
```

Abre `http://localhost:8080`. La primera vez descargará el modelo (~180 MB) con barra de progreso; después queda en la caché del navegador.

## Deploy (hosting estático)

Arrastra la carpeta a **Cloudflare Pages**, **Netlify** o súbela a **GitHub Pages**. No hay build step.

Se incluyen `_headers` (Cloudflare Pages / Netlify) y `netlify.toml` con:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Estos headers habilitan `SharedArrayBuffer` → **WASM multihilo**, que acelera notablemente la CPU cuando no hay WebGPU. Se usa `credentialless` (más permisivo que `require-corp`) porque la app carga recursos de jsDelivr, Hugging Face y Google Fonts. Si en tu hosting algún recurso externo dejara de cargar, elimina estos headers: la app funciona igual, solo pierde el multihilo en CPU.

## Estructura

```
index.html          UI (español)
css/style.css       Tema oscuro de editor; verde = conservar, magenta = borrar
js/main.js          Estado, cola por lotes, ajustes, exportación, atajos
js/worker.js        Transformers.js + RMBG-1.4 en un Web Worker (webgpu→wasm, fp32)
js/compositor.js    Pipeline de calidad: máscara → alpha del original → fondo/sombra → export
js/editor.js        Viewport: zoom/pan, pincel con overlay, comparador
_headers            COOP/COEP para Cloudflare Pages / Netlify
netlify.toml        Ídem para Netlify
```

Comunicación main ↔ worker con `postMessage` y **transferables** (los `ArrayBuffer` de píxeles y máscara se transfieren, no se copian).

## ⚠️ Licencia del modelo (importante)

`briaai/RMBG-1.4` es *source-available* de **BRIA AI** y su licencia permite **solo uso no comercial**. Para uso comercial hay que adquirir una licencia con BRIA (enlace en la [ficha del modelo](https://huggingface.co/briaai/RMBG-1.4)).

Si el proyecto va a ser comercial y no quieres licenciar, cambia `MODEL_ID` en `js/worker.js` por una alternativa de licencia permisiva compatible con Transformers.js (p. ej. modelos basados en ISNet/U²-Net, o BiRefNet — **verifica la licencia de cada uno**). El worker ya extrae la máscara de forma defensiva (acepta `{mask}` de 1 canal o `RawImage` con alpha), así que muchos modelos de segmentación funcionan sin tocar el resto de la app.

El código de la app en sí no impone restricciones.

## Solución de problemas

- **"WASM (CPU)" en el chip del modelo:** tu navegador no expone WebGPU (o no dentro de Workers). Funciona igual, solo más lento. Chrome/Edge recientes lo soportan.
- **La primera imagen tarda mucho:** es la descarga del modelo + compilación inicial. Las siguientes son mucho más rápidas.
- **"Copiar al portapapeles" falla:** la Clipboard API requiere contexto seguro (HTTPS o `localhost`).
- **Fotos gigantes (>6000 px):** se procesan a resolución completa, pero el consumo de memoria crece rápido en lotes grandes; la app avisa al añadirlas.
- **Quiero actualizar Transformers.js:** ya existe la rama v4. Antes de subir la versión en `js/worker.js`, verifica que `pipeline('image-segmentation', 'briaai/RMBG-1.4')` siga devolviendo la máscara con la misma forma (la extracción defensiva de `worker.js` cubre variaciones razonables).

## Ideas para siguientes fases

- Service Worker para funcionar 100% offline tras la primera visita (la app + el modelo ya cacheado).
- Dureza/suavidad por trazo del pincel.
- Recorte automático al sujeto (*trim* del bounding box del alpha) como opción de exportación.
- Selector de modelo (RMBG-1.4 / BiRefNet / ISNet) con aviso de licencia por modelo.
