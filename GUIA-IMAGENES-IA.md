# Guía: generar imágenes con ChatGPT para un recorte perfecto en PixelPeel

PixelPeel usa **RMBG-1.4**, un modelo de *segmentación de objeto saliente*: no hace chroma key (no busca un color de fondo), sino que detecta cuál es **el sujeto principal** de la imagen y lo separa. Entender eso cambia qué conviene pedirle a ChatGPT.

---

## Regla de oro

> **Un solo sujeto, completo, centrado, sobre fondo liso y neutro que contraste con él.**

Si cumples eso, el recorte sale perfecto en el 95% de los casos. Todo lo demás de esta guía son matices.

---

## ¿Qué fondo pedir? (lo más importante)

| Fondo | Veredicto | Por qué |
| --- | --- | --- |
| **Blanco liso / gris claro de estudio** | ✅ **La mejor opción general** | El modelo fue entrenado con muchísima fotografía de producto sobre fondo claro. Bordes limpios y sin contaminación de color. |
| **Gris medio / gris oscuro** | ✅ Ideal para sujetos blancos o muy claros | El contraste importa más que el color: un objeto blanco sobre fondo blanco confunde al modelo. |
| **Verde chroma / colores saturados** | ⚠️ **Evítalo** | No aporta nada (el modelo no hace chroma key) y sí perjudica: PixelPeel conserva los colores originales intactos, así que en los bordes semitransparentes (pelo, pelusa, desenfoque) queda un **halo verde** imposible de quitar sin degradar la imagen. |
| **Negro** | ⚠️ Solo para sujetos claros | Funciona, pero los bordes suaves quedan con franja oscura. Prefiere gris claro salvo que el sujeto sea muy claro. |
| **Fondos con textura, escenas, degradados fuertes** | ❌ Evítalo | El modelo puede confundir elementos del fondo con parte del sujeto, sobre todo si hay objetos cerca del sujeto. |

**En resumen: pide fondo blanco o gris claro liso. Si el sujeto es blanco/muy claro, pide fondo gris medio. Nunca pidas verde.**

### ¿Y pedir un contorno alrededor del sujeto?

**No.** Un contorno o borde dibujado alrededor del sujeto es contraproducente: el modelo lo interpreta como parte del sujeto y lo incluye en el recorte, y luego tendrás que borrarlo a mano. El "contorno" que necesita el modelo es simplemente **contraste natural** entre sujeto y fondo.

---

## Prompt base recomendado (cópialo y adáptalo)

Añade esto al final de tu prompt de ChatGPT:

> *"...sobre un fondo blanco liso de estudio, sin sombras proyectadas, sin reflejos en el suelo, iluminación uniforme y difusa, el sujeto completo y centrado con margen alrededor, sin ningún elemento tocando los bordes de la imagen."*

Cada frase tiene un motivo:

- **"fondo blanco liso de estudio"** → fondo uniforme que el modelo separa sin esfuerzo.
- **"sin sombras proyectadas, sin reflejos en el suelo"** → el modelo a veces incluye la sombra como parte del sujeto (queda una mancha gris pegada a los pies) y a veces la corta a la mitad. Es mejor generar sin sombra y **añadirla en PixelPeel** (sección SOMBRA), que además la escala correctamente y la puedes ajustar.
- **"iluminación uniforme"** → las zonas del sujeto en penumbra profunda pueden confundirse con el fondo.
- **"sujeto completo y centrado con margen"** → si el sujeto toca el borde de la imagen o está cortado, la máscara en esa zona queda arbitraria.

---

## Recetas por tipo de imagen

### 🛍️ Productos (botellas, zapatos, gadgets, comida)
- Fondo **blanco o gris claro**, estilo foto de catálogo.
- Pide *"sin superficie reflectante debajo"*: los reflejos en mesas brillantes se recortan mal (mitad sí, mitad no).
- Si el producto es blanco (una zapatilla blanca, un frasco de crema), pide **fondo gris medio**.

### 🧑 Personas y retratos
- Fondo **gris claro neutro** mejor que blanco puro (mejor contraste con piel clara y camisas blancas).
- El pelo es lo más difícil: pide *"pelo bien definido, separado del fondo"* y evita pelo del mismo tono que el fondo.
- En PixelPeel, usa **Suavizado 1–3 px** para retratos: difumina solo el borde de la máscara y el pelo queda natural.
- Evita poses donde el brazo forma un hueco con el cuerpo si puedes — los huecos internos a veces requieren un toque del pincel **Borrar**.

### 🐕 Animales y peluches
- Igual que retratos: fondo neutro contrastado, **Suavizado 2–4 px** para el pelaje.
- Evita pelaje del mismo color que el fondo (gato blanco → fondo gris).

### 🎨 Logos, ilustraciones y objetos gráficos
- Aquí sí puedes ser más agresivo: fondo **blanco puro** y bordes nítidos.
- Suavizado en **0 px** para mantener los bordes vectoriales crujientes.
- Mejor aún: si es un logo plano, pídele a ChatGPT directamente *"PNG con fondo transparente"* — a veces no necesitas PixelPeel (ver abajo).

### 🪑 Objetos con huecos (sillas, bicicletas, gafas, plantas)
- Fondo liso es **crítico** aquí: cada hueco es una oportunidad de error.
- Revisa los huecos con **Comparar (C)** y limpia restos con el pincel **Borrar (E)**.

### 🍷 Vidrio, cristal y objetos translúcidos
- El caso más difícil para cualquier modelo. La transparencia real no se puede representar bien con una máscara.
- Pide *"vidrio con bordes bien definidos y reflejos marcados"* sobre fondo gris.
- Acepta que necesitarás retoque manual, o considera pedir la imagen ya con el fondo final que querías.

### 🚗 Sujetos grandes (coches, muebles, edificios)
- Pide *"vista completa con amplio margen alrededor"* — es el error más común: el sujeto cortado por los bordes.
- Sombras: los coches casi siempre se generan con sombra en el suelo; pide explícitamente *"sin sombra en el suelo"*.

---

## Errores comunes y su solución

| Síntoma en PixelPeel | Causa probable | Solución |
| --- | --- | --- |
| Queda una mancha gris bajo el sujeto | Sombra proyectada en la imagen generada | Regenera pidiendo "sin sombras"; añade la sombra en PixelPeel |
| Halo de color en los bordes del pelo | Fondo saturado (verde, azul intenso) | Regenera con fondo neutro claro |
| El modelo borró parte del sujeto | Poco contraste sujeto/fondo en esa zona | Pincel **Restaurar (B)**, o regenera con más contraste |
| Se recortó también un objeto secundario | Varios objetos en escena | El modelo elige "lo saliente": deja solo un sujeto por imagen |
| Bordes duros tipo "pegatina" en un retrato | Suavizado en 0 | Sube **Suavizado** a 1–3 px |
| Huecos internos sin recortar (asa de taza) | Limitación normal del modelo | Pincel **Borrar (E)** con zoom |

---

## Consejos extra

1. **ChatGPT puede generar PNG con fondo transparente directamente** (pídelo: *"genera la imagen en PNG con fondo transparente"*). Para logos e ilustraciones planas suele bastar. Para sujetos fotorrealistas, el resultado de generar sobre fondo gris + recortar en PixelPeel suele dar bordes más naturales — prueba ambos caminos.
2. **Genera a la mayor resolución posible.** La máscara del modelo se calcula a ~1024 px y PixelPeel la escala con interpolación de alta calidad, pero los detalles más finos que ~2 px a escala 1024 (pelos sueltos, cuerdas finas) pueden perderse.
3. **El flujo ideal para composiciones:** genera el sujeto solo sobre fondo neutro → recorta en PixelPeel → usa la sección **FONDO** para poner el color, degradado o imagen final. Controlas cada pieza por separado en vez de esperar que ChatGPT lo componga todo bien de una vez.
4. **Lote de imágenes:** si vas a generar una serie (p. ej. varios productos), usa el mismo prompt de fondo en todas — así el comportamiento del recorte es consistente y puedes exportarlas todas juntas con "Descargar todas (.zip)".

---

*Guía escrita para PixelPeel con el modelo `briaai/RMBG-1.4`. Si cambias de modelo (BiRefNet, ISNet), las recomendaciones de fondo neutro y sujeto único siguen aplicando: todos son segmentadores de objeto saliente, no chroma keyers.*
