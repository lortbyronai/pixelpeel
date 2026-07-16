# PixelPeel — ¿Cómo funciona? (explicado para todos)

Una explicación sin palabras raras, para que la entienda cualquiera: desde un niño hasta tu abuela.

---

## ¿Qué hace PixelPeel?

Imagina que tienes una foto de tu perro en el parque y quieres **solo al perro**, sin el parque. Como cuando recortas una figura de una revista con tijeras, pero perfecto y en un segundo.

Eso hace PixelPeel: le das una foto, y te devuelve la figura recortada. Después puedes ponerle el fondo que quieras: ningún fondo, un color, un degradado o incluso otra foto.

## ¿Quién recorta? ¿Hay una persona detrás?

No. Recorta una **inteligencia artificial**: un programa que "aprendió a ver".

¿Y cómo aprendió? Le mostraron **millones de fotos** junto con su recorte perfecto hecho por personas. Foto de un gato → recorte del gato. Foto de una botella → recorte de la botella. Millones de veces. Después de ver tantísimos ejemplos, el programa captó el truco: aprendió a distinguir *"esto es lo importante de la foto"* de *"esto es solo el fondo"*.

Es como cuando aprendiste a distinguir un perro de un gato: nadie te dio una lista de reglas. Viste muchos perros y muchos gatos, y tu cerebro solito encontró la diferencia. Aquí pasó lo mismo, pero con recortes.

## El truco del esténcil (así recorta sin estropear tu foto)

Cuando le das tu foto, la inteligencia artificial **no borra nada**. Lo que hace es dibujar una plantilla, como un esténcil:

- Pinta de **blanco** lo que hay que conservar (tu perro).
- Pinta de **negro** lo que hay que ocultar (el parque).

Luego PixelPeel pone ese esténcil sobre tu foto original, como una hoja con un agujero con la forma exacta del perro. Tu foto queda intacta debajo — con todos sus colores y toda su calidad — solo que el fondo queda tapado y se vuelve invisible.

Por eso, si la IA se equivocó en un pedacito, tú puedes corregirlo con los pinceles:

- El pincel **verde (Restaurar)** hace un agujerito más en el esténcil: recupera algo que la IA tapó por error.
- El pincel **magenta (Borrar)** tapa un agujerito: oculta un resto de fondo que se coló.

Nunca estás pintando sobre tu foto. Solo estás retocando el esténcil. Por eso siempre puedes deshacer y volver a empezar sin perder nada.

## Lo más sorprendente: todo pasa en TU computadora

Casi todas las páginas que hacen esto **envían tu foto a sus computadoras**, la procesan allá, y te devuelven el resultado. Tu foto viaja por internet y queda quién sabe dónde.

PixelPeel no. La primera vez que abres la página, descarga el "cerebro" de la inteligencia artificial (pesa como una película corta, unos 180 MB) y lo guarda en tu navegador. A partir de ahí, **todo el trabajo ocurre dentro de tu computadora**:

- Tus fotos **nunca salen de tu equipo**. Nadie más las ve. Ni siquiera quien hizo PixelPeel.
- Después de la primera vez, ya no necesita descargar nada — el cerebro queda guardado.
- No hay que pagar por cada foto, porque no hay ninguna empresa procesándolas: lo hace tu propia máquina.

Es la diferencia entre mandar tu ropa a una lavandería y tener lavadora en casa.

## ¿Por qué a veces tarda más o menos?

Tu computadora tiene dos "trabajadores" que pueden hacer el cálculo:

- La **tarjeta gráfica (GPU)**: una especialista rapidísima en este tipo de tarea. Si tu navegador la deja trabajar, el recorte sale en uno o dos segundos.
- El **procesador (CPU)**: el trabajador de siempre. Sabe hacerlo todo, pero esto le cuesta más — puede tardar bastantes segundos por foto.

PixelPeel intenta usar primero a la especialista, y si no está disponible, llama al procesador. Arriba a la derecha te dice cuál está trabajando: "WebGPU (GPU)" es la rápida, "WASM (CPU)" es la lenta pero segura.

La primera foto siempre tarda un poco más: es el momento en que el cerebro "se despierta y se prepara". Las siguientes van mucho más rápido.

## ¿Y si la IA se equivoca?

Se equivoca a veces, sobre todo con cosas difíciles:

- **Pelo suelto y despeinado** — hasta con tijeras de verdad sería difícil.
- **Vidrio y cosas transparentes** — ¿dónde termina un vaso de agua? Ni las personas se ponen de acuerdo.
- **Fotos con muchas cosas** — si hay tres objetos, la IA elige el que le parece protagonista, que puede no ser el que tú querías.

Para eso están los pinceles de corrección, la lupa (zoom) y el botón de **Comparar**, que te muestra el antes y el después con una cortinilla que arrastras.

**El mejor consejo:** dale fotos donde el protagonista se distinga bien del fondo. Un gato negro sobre una alfombra negra es difícil hasta para la IA; un gato negro sobre un piso claro sale perfecto.

## Preguntas que siempre hacen

**¿Necesito internet?**
Solo la primera vez, para descargar el cerebro de la IA. Las fotos nunca usan internet.

**¿Me cuesta dinero?**
No. Tu computadora hace el trabajo, así que no hay nada que cobrar por foto.

**¿La foto pierde calidad?**
No. PixelPeel nunca toca los colores ni los píxeles de tu foto original — solo decide qué partes se ven y cuáles no. El recorte tiene exactamente la misma calidad que la foto que le diste.

**¿Puedo recortar muchas fotos a la vez?**
Sí. Arrastra todas juntas y se van recortando una por una solitas, como una fila en la caja del supermercado. Al final puedes descargarlas todas juntas en un archivo .zip.

**¿Por qué la primera vez tardó tanto en abrir?**
Estaba descargando el cerebro de la IA (~180 MB). Es solo la primera vez — queda guardado para siempre en tu navegador.
