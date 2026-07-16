# PixelPeel — Ideas, roadmap y posibilidades de la IA en el navegador

Documento vivo con: (1) mejoras y siguientes pasos para PixelPeel, y (2) el mapa de qué más se puede construir con Transformers.js y tecnologías similares. Escrito el 2026-07-16.

---

## Parte 1 — Roadmap de PixelPeel

### Mejoras de corto plazo (bajo esfuerzo, la app ya lo permite)

| Mejora | Detalle | Esfuerzo |
| --- | --- | --- |
| Service Worker offline | La app + el modelo ya cacheado → funciona 100% sin internet tras la primera visita | Bajo |
| Recorte automático al sujeto (*trim*) | Opción de exportación que recorta el lienzo al bounding box del alpha (útil para stickers y e-commerce) | Bajo |
| Dureza/suavidad por trazo del pincel | Hoy los trazos son 100% duros; un slider de dureza daría bordes de pincel difuminados | Bajo-medio |
| Presets de exportación | "Sticker WhatsApp (512×512 WebP)", "Producto Amazon (fondo blanco JPG)", "Foto carnet" — tamaño + formato + fondo en un clic | Bajo |

### Mejoras de mediano plazo

| Mejora | Detalle | Esfuerzo |
| --- | --- | --- |
| **Selector de modelo** | RMBG-1.4 / BiRefNet / ISNet con aviso de licencia por modelo. El worker ya extrae la máscara de forma defensiva, así que muchos modelos funcionan sin tocar el resto | Medio |
| **Recorte por clic (SAM / SlimSAM)** ⭐ | En vez de "lo saliente", el usuario hace clic sobre el objeto que quiere. Resuelve el caso "hay varios objetos y recortó el equivocado". Reutiliza casi toda la app: solo cambia el modelo del worker y se añade el clic como entrada | Medio |
| Detección + pixelado de caras | Anonimizador de fotos: detectar caras y difuminarlas automáticamente. Encaja con la promesa de privacidad de la app | Medio |
| Mejora de resolución (super-resolution) | Escalar la imagen antes o después del recorte. Combina perfecto con imágenes de ChatGPT que salen a baja resolución | Medio |

### Apuestas grandes (largo plazo)

| Mejora | Detalle | Esfuerzo |
| --- | --- | --- |
| **PixelPeel para video (offline)** | Quitar el fondo de clips grabados: decodificar con WebCodecs fotograma a fotograma → mismo pipeline de máscara → recodificar. Un clip de 10 s a 30 fps = 300 inferencias (minutos de espera con WebGPU, aceptable como proceso batch). La calidad RMBG aplicada a video es diferenciador real | Alto |
| Desenfoque de fondo con profundidad (Depth Anything) | En vez de borrar el fondo, desenfocarlo gradualmente según distancia = efecto retrato profesional. Nueva "salida" del mismo pipeline | Alto |
| Parallax 3D | Con el mapa de profundidad, animar la foto con efecto 3D al mover el ratón; exportar como video corto | Alto |

### Nota permanente: licencia del modelo

`briaai/RMBG-1.4` es **solo uso no comercial**. Antes de monetizar cualquier versión: licenciar con BRIA o migrar a un modelo permisivo (verificar licencia de BiRefNet/ISNet/U²-Net en el momento). El selector de modelo del roadmap convierte esto en una opción del usuario.

---

## Parte 2 — Qué más se puede construir (el patrón PixelPeel aplicado a otros dominios)

El patrón: **IA que corre en el navegador del usuario → privada por diseño, costo cero por uso, sin backend que mantener.** El modelo se descarga una vez y queda cacheado. Ideal para *transformar* contenido (segmentar, transcribir, detectar, mejorar); no para generación pesada.

### Imágenes

- **Recorte por clic (SAM):** clic sobre cualquier objeto y la IA lo segmenta. También útil como app independiente de anotación.
- **Profundidad (Depth Anything):** mapa de cerca/lejos desde una foto → efecto retrato, niebla, parallax 3D.
- **Super-resolution:** agrandar imágenes pequeñas sin pixelar.
- **OCR (TrOCR y similares):** extraer texto de fotos y escaneos. Atractivo justamente para documentos sensibles que no deben subirse a ningún servidor.
- **Detección de objetos (DETR/YOLO):** contar, etiquetar, o detectar caras para **pixelarlas automáticamente** (anonimizador de fotos = muy buena app privada).
- **Búsqueda semántica de fotos (CLIP):** escribir "fotos de playa al atardecer" y encontrar las tuyas que coinciden, sin que ninguna salga del equipo. Un "Google Photos privado".
- **Clasificación / captioning:** describir imágenes automáticamente (alt text, organización de bibliotecas).

### Audio (de lo más maduro en navegador)

- **Whisper — transcripción de voz a texto:** funciona sorprendentemente bien y en muchos idiomas. Apps: transcriptor de reuniones privado, subtitulador, notas de voz → texto. ⭐ *Mejor candidato a "segundo proyecto": arquitectura calcada a PixelPeel (worker + modelo cacheado + todo local) y el resultado impresiona.*
- **Texto a voz (Kokoro):** voces naturales generadas localmente → lector de artículos.
- **Combinaciones:** transcribir + resumir una reunión, todo sin servidor.

### Texto

- **LLMs pequeños (1–3B) con WebGPU** (Transformers.js o WebLLM): resumir, reescribir, clasificar, autocompletar. No son GPT-4, pero para tareas acotadas cumplen.
- **Embeddings + búsqueda semántica local:** "pregúntale a tus documentos" — indexar PDFs/notas y buscar por significado. 100% privado.
- **Traducción offline** (NLLB / Opus-MT).

### Video

- **Fondo virtual de webcam en tiempo real** (tipo Zoom): viable, pero NO con RMBG-1.4 (demasiado pesado para 30 fps). Usar modelos de tiempo real: **MediaPipe Selfie Segmentation** o **MODNet** — menos finos en pelo, pero corren a 30–60 fps.
- **Quitar fondo de video grabado (offline):** aquí sí con calidad RMBG, vía WebCodecs fotograma a fotograma (ver roadmap, Parte 1).
- **Otras:** detección de escenas para autocortar clips, blur de caras en video, extracción del mejor fotograma.

---

## Parte 3 — Límites reales a tener en cuenta

1. **El tamaño del modelo es el "costo de entrada".** PixelPeel: 180 MB una vez. Un LLM: 1–2 GB. Whisper (small): ~250 MB. El usuario lo paga en la primera visita; después queda cacheado. Más de ~2 GB empieza a ser hostil para web.
2. **WebGPU marca la diferencia.** En Chrome/Edge recientes vuela; el fallback a CPU (WASM) puede ser 10–20× más lento. Para tiempo real (video/webcam), WebGPU es prácticamente obligatorio.
3. **Transformar sí, generar no (todavía).** Stable Diffusion en navegador existe como demo pero es lento y frágil. La regla práctica: **generar → nube; transformar (segmentar, transcribir, detectar, mejorar) → navegador.**
4. **Memoria en lotes grandes.** Fotos >6000 px a resolución completa consumen mucha RAM en lotes; para video, procesar en streaming (no cargar todos los fotogramas a la vez).
5. **Verificar licencias siempre.** Cada modelo de Hugging Face tiene la suya; "open weights" no siempre significa uso comercial permitido.

---

## Recomendación de próximos pasos (por relación impacto/esfuerzo)

1. **Añadir SAM (recorte por clic) a PixelPeel** — reutiliza casi todo lo construido y elimina la mayor frustración del usuario (que recorte el objeto equivocado).
2. **Transcriptor de audio privado con Whisper** — como app hermana; misma arquitectura, dominio nuevo, resultado vistoso.
3. **Service Worker offline + presets de exportación** — pulido barato que hace la app redonda.
4. **PixelPeel para video** — la apuesta grande cuando lo anterior esté maduro.
