# ESTADO — BioFit

> 🔄 **Este archivo se REESCRIBE COMPLETO en cada cambio. Nunca se le agrega abajo.**
> Quien haga un cambio (Claude Code o Claude chat) lo regenera entero como último
> paso. Así nunca crece y nunca miente.
>
> La lista completa de pendientes vive en `TAREAS.md`. El contexto permanente del
> proyecto, en `CLAUDE.md`. Aquí va **solo lo de hoy**.

---

## 1. Sello

| | |
|---|---|
| **Fecha** | 26/09/2026 |
| **Última escritura** | Claude Code |
| **Siguiente** | Christopher — **mandar la portada en grande**, **reservar una cita de prueba** y **cargar los horarios de Lince** |

## 🚨 Lo primero

**1. La portada es el consultorio y llena la pantalla entera.** Se probó
`contain` (para que se viera el ambiente completo) y quedaba encajonada con dos
bandas blancas a los lados, así que volvió a `cover`. **Si tienes la foto en
grande, mándala igual**: la que hay salió de una de 736×490.

**2. Haz una reserva de prueba con tu correo.** Comprueba de un tiro que el
correo llega **bien formado** (hoy llegaba como texto crudo) y que el botón
**"Cancelar mi cita"** funciona de punta a punta.

**3. Lince ya no deja entrar.** Su tarjeta lleva una pestañita **"Próximamente"**
y no se puede pulsar. Se desbloquea **sola** en cuanto le cargues el primer horario.

---

## 2. Cambios en la base (hoy fue UNA, la que faltaba)

| Migración | Qué hizo |
|---|---|
| `cancelacion_por_el_socio` | Punto 15 de `TAREAS.md`, y cierra el 7 |

Estaba **escrita desde ayer pero sin correr**: Claude Code había perdido el
acceso a Supabase a mitad de aquella sesión. Hoy se recuperó, se verificó que la
base seguía intacta y se aplicó.

Archivo, con su SQL de reversa:
`supabase/migraciones/2026-09-26-cancelacion-por-el-socio.sql`.

### Qué agregó

- **4 columnas en `citas`**: `token_cancelacion`, `cancelada_por`,
  `cancelada_por_origen`, `cancelada_en`
- **4 funciones**: `nuevo_token_cancelacion()`, `marcar_quien_cancelo()`,
  `cita_por_token()`, `cancelar_cita_por_token()`
- **2 triggers**: `trg_marcar_quien_cancelo`, `trg_notificar_cita_cancelada`
- **1 trigger eliminado**: `trg_notificar_cita_delegada`, que ya no se disparaba
  nunca porque nada vuelve a escribir `asignado_a`

Después se corrió un `revoke` suelto: `nuevo_token_cancelacion()` había quedado
ejecutable por `authenticated`. No daba acceso a nada, pero era superficie de más.

### ⚠️ Tu decisión, ya aplicada: **2 horas**

Se puede cancelar **hasta 2 horas antes**. **El plazo lo decide la BASE, no el
navegador**: validarlo en el frontend sería saltable desde la consola.

### ⚠️ El WEBHOOK_SECRET no pasó por el repositorio

`notificar_cita()` lo lleva embebido y **el repo es público**. La migración lo lee
de la función que ya está en la base y lo vuelve a colocar. **Si algún día hay que
tocar esa función, usar el mismo truco.**

### ⚠️ Cancelar desde el panel AHORA manda correo

Antes no avisaba a nadie. Desde hoy, cancelar una cita —desde el panel o desde el
enlace del socio— avisa a los correos de esa sede diciendo **quién canceló**.
Es el punto 7, que ya estaba aprobado.

---

## 3. 🐛 El correo roto: qué pasó y por qué

El de hoy 8:15 a.m. ("Nueva cita: Mónica Rivera carranza — Sede Jesús María")
llegó con el asunto sin decodificar y **el mensaje entero como texto plano**: se
veían el `From`, el `To`, el `Date` y los `--attachment100` a la vista.

**No tuvo nada que ver con asignarte sedes.** Fue una cita real de Jesús María, y
te llegó porque estás en los correos de esa sede.

La culpa es de `denomailer@1.6.0`. Pasa el asunto por
`quotedPrintableEncodeInline()`, que arma **un solo** encoded-word con tres
defectos encadenados:

1. deja los **espacios literales** dentro, cosa que RFC 2047 prohíbe — por eso
   Gmail ni lo intenta decodificar y lo muestra crudo;
2. no lo corta en los **75 caracteres** que exige la norma;
3. y encima le mete **un salto de línea cada 74 caracteres SIN el espacio de
   continuación**.

El tercero rompe el correo entero: ese salto parte la cabecera `Subject` en dos,
la segunda mitad (`da?=`, que se veía al inicio del cuerpo) ya no tiene forma de
cabecera, el lector da por cerrada la zona de cabeceras ahí mismo, y **todo lo que
sigue se muestra como cuerpo**.

**Por qué no había pasado antes:** hace falta un asunto largo y con varias tildes
para cruzar los 74 caracteres. "Mónica… — … Jesús María" tiene `ó`, `—`, `ú` e `í`.

### Cómo se arregló

`asuntoCabecera()` arma la cabecera bien: encoded-words en **Base64**, cortados en
límites de carácter y plegados con **CRLF + espacio**.

⚠️ **El espacio del principio no es un descuido.** `quotedPrintableEncodeInline()`
vuelve a codificar todo lo que empiece con `"=?"`. Ese espacio se lo evita. **Si
alguien lo "limpia", el asunto se codifica dos veces.**

---

## 4. La cancelación por el socio, completa

### El botón, en el correo de confirmación

Lleva el **token**, nunca el id de la cita. Apunta a
`…/Sistemas-de-Citas-BioFit/?cancelar=<token>`. La URL del sitio vive en la
constante `SITIO_URL` de la Edge Function: **si BioFit compra un dominio, se
cambia ahí y se redespliega**.

### La pantalla (`src/js/cancelar.js`, vista `view-cancelar`)

Cuatro estados: buscando · enlace inválido o fuera de plazo · la cita con
confirmación · cancelada.

- El botón destructivo **no** es el primario, y en móvil "No, mantenerla" queda
  arriba
- El token **se borra de la barra de direcciones** apenas se usa: si no, viaja en
  el historial, en el Referer y en cualquier enlace que el socio copie

⚠️ **El anónimo sigue sin poder leer ni editar `citas`.** Comprobado: como `anon`,
un `select` directo devuelve **cero filas**.

⚠️ **El token no se filtra al frontend.** Auditado: el insert del socio no pide
`.select()`, y los `select` del panel nombran sus columnas una por una.
**Si alguien escribe un `select *` sobre `citas`, lo filtra.**

---

## 5. 🚪 La entrada cambió: un solo botón, y Lince bloqueada

### Se acabó el "SOY SOCIO / SOY NUEVO"

La portada tiene **un solo botón: "Agendar mi asesoría"**. Antes eran dos y la
única diferencia era cuánto se acompañaba a la persona: **el socio de siempre se
saltaba los requisitos de la evaluación** (ayunas, sin líquidos, sin ejercicio,
ropa deportiva).

Ahora **los ve todo el mundo**, como pediste. Quien ya vino no pierde nada por
releerlos, y quien los necesitaba ya no depende de haber elegido bien el botón.

Todo el mundo hace ahora el camino que antes hacía el "nuevo":
**portada → requisitos → sede → horario → datos → confirmación**, con el aviso de
preparación también en el formulario y en la confirmación. Desapareció
`state.esNuevo` y con él toda la bifurcación.

### Una sede sin horarios ya no se puede pulsar

Su tarjeta sale en gris con una **pestañita "Próximamente"** en la esquina
superior derecha, y nada más. La pestaña va **fuera del flujo** (posicionada
sobre la tarjeta), así que la tarjeta conserva la misma estructura que las otras
—nombre y dirección— y **todas miden exactamente igual**: la grilla usa
`grid-auto-rows: 1fr`.

- El botón va **`disabled` de verdad**, no apagado con CSS: tampoco entra con
  Enter ni con el tabulador
- **No nombra ninguna sede en el código.** Se decide preguntando a la base si la
  sede tiene **algún** horario, sin filtrar por fecha ni disponibilidad. Se abre
  **sola** al cargar el primero, y una sede nueva hereda el comportamiento gratis
- **Se desbloquea en vivo**: hay Realtime sobre `horarios_disponibles`, así que si
  cargas horarios de Lince con la página abierta, la tarjeta se activa sin recargar
- Si la consulta **falla**, no se bloquea nada: es preferible dejar pasar y que el
  calendario avise, a cerrarle la puerta a un socio por un problema de red
- El bloque "Próximamente" del calendario **se queda** como red de seguridad, por
  si alguien llega ahí por otro camino

Hoy: Magdalena **82** horarios · Jesús María **283** · Lince **0**.

---

## 6. 🖼️ La portada y el fondo

La foto cambió otra vez, y esta vez es **muy distinta**: ya no es el gimnasio
oscuro y azulado, sino una toma **clara** (manzana, pesas y cinta métrica sobre
mantel blanco). Se copió **tal cual, sin recomprimir**: ya venía en 24 KB, y
volver a guardarla solo le habría quitado calidad. Es la máxima fidelidad
posible al archivo que mandaste, y de paso la página bajó a **870 KB**.

### El velo tuvo que bajar bastante: de 0,75 a **0,60**

Con la foto anterior, oscura, el 0,75 funcionaba. Con esta, clara, el fondo
quedaba en `rgb(240,241,237)` — **prácticamente el color de fondo liso: la foto
no se veía**. Medido sobre la foto real:

| Velo | Fondo promedio | Texto normal | Pie de página |
|---|---|---|---|
| 0,75 | rgb(240,241,237) — invisible | 9,0:1 | 2,5:1 |
| **0,60 (puesto)** | **rgb(235,237,230)** | **14,8:1 · peor caso 5,8:1** | **4,1:1** |

Ojo al dato bueno: el pie de página **mejoró** respecto a la foto oscura (era
3,0:1, ahora 4,1:1 de promedio), porque esta foto es clara. En el peor caso
—justo encima de una pesa— baja a 1,6:1, pero es una franja pequeña de la imagen.

**En `styles.css`, en `body::before`, el 0,60 es el único número que hay que
mover**: bajarlo para que se note más, subirlo para que se note menos.

### El fondo ya no está en `body`, sino en una capa fija

Pasó a `body::before` con `position: fixed`. Dos motivos: **cubre siempre el
viewport exacto** (antes, en el móvil, el body crecía con el contenido y la foto
se estiraba) y **no salta al hacer scroll**. Es `fixed` en el elemento, no
`background-attachment: fixed`, que en iOS no funciona.

- **En pantallas angostas la foto se ancla a la izquierda.** Los objetos están
  arriba a la izquierda y el resto es mantel vacío: centrada, un celular
  recortaba los lados y dejaba justo el vacío.
- **Sin desenfoque.** Se probó ponerle 2px en pantallas grandes para disimular
  que la foto venía a 626×352, y se veía sucio: era lo primero que saltaba a la
  vista. **No volver a hacerlo.**

### El fondo llena la pantalla: `cover`

El fondo usa `background-size: cover`. **Se intentó `contain`** —para que se viera
el consultorio completo, sin recortar— y el resultado fue peor: la foto quedaba
encajonada en el centro con **dos bandas blancas a los lados**, y se leía como un
error de maquetación más que como un fondo. Christopher lo pidió estirado.

Con `cover` se recorta algo (en 16:9 se va parte del techo y del piso), pero el
escritorio, las sillas y la balanza —lo que da el ambiente— quedan siempre.

⚠️ Por eso la imagen se sube a **1920 de ancho**: al llenar una pantalla de 1080p
el navegador no tiene que estirar nada.

⚠️ **En un celular vertical `cover` recorta bastante a los lados**, y se ve la
franja central (escritorio y sillas). Es el precio de llenar la pantalla; si
alguna vez molesta, se ajusta con `background-position` en una media query, no
volviendo a `contain`.

La foto es bastante oscura (brillo medio **23/100**), así que el velo 0,60 le
viene bien: el texto sobre el fondo queda en **10,1:1** de media y **5,8:1** en el
peor caso, holgado.

### La nitidez: reescalada, no desenfocada

Los archivos que has mandado vienen pequeños (el del consultorio, **736×490**). El
primer intento fue tapar eso con un desenfoque, y **se veía peor**: lo que se
notaba era el desenfoque.

Lo que se hizo en su lugar: subir la imagen ya reescalada con **LANCZOS y una
máscara de enfoque**, así el navegador no tiene que estirar casi nada y no hay que
tapar nada. La del consultorio va a **1920×1278**, que es lo que pide `cover` en
una pantalla de 1920 de ancho. Cuesta **156 KB** y deja la página en **1047 KB**.

⚠️ **Se reescala SIEMPRE desde el archivo original de Christopher**, nunca desde el
que ya está en `src/assets/`: reescalar sobre un reescalado acumula pérdida.

**Si tienes el original en grande, mándalo igual:** ampliar no inventa detalle, y
con la foto nativa esto se vuelve innecesario.

## 7. Cómo se verificó

### La base, contra producción

| Caso | Resultado |
|---|---|
| Columnas nuevas en `citas` | **4 de 4** |
| Citas confirmadas con token | **30 de 30** |
| Citas canceladas con token | **0 de 7** — correcto |
| `anon` puede ejecutar las 2 funciones | sí |
| `anon` puede leer `citas` | **no**, 0 filas |
| Token corto, inexistente o nulo | **0 filas** en los tres |
| Cita futura con margen | `puede_cancelar = true` |
| Cita pasada | `puede_cancelar = false` + motivo |

### El flujo completo de cancelación, **y revertido**

Corrido dentro de un bloque que termina lanzando una excepción a propósito, así
que **no se canceló ninguna cita real ni salió ningún correo**:

| | |
|---|---|
| 1er intento | `{"ok": true}` |
| 2do con el mismo token | `{"ok": false, "motivo": "Este enlace ya no sirve…"}` |
| Estado final | `cancelada` |
| Origen | **`socio`** — el trigger no lo pisó, que era el punto delicado |
| Token quedó en NULL | sí |
| Horario liberado | **ocupado → libre**, solo |

Comprobado después: 30 confirmadas, 7 canceladas, 0 con origen. Idéntico a antes.

### El asunto del correo

Probado en aislado con los 4 asuntos reales: decodifica **idéntico** al original,
todo ASCII, encoded-word más largo **60** (límite 75), línea más larga **70**
(límite 78).

### El frontend

- `node --check` sobre los 12 módulos y sobre el bundle combinado
- **97 `getElementById` distintos comprobados contra los 121 ids del HTML: ninguno
  apunta a un elemento que no existe.** Es la prueba que atrapa lo que suele
  romperse al quitar botones, como los dos de la portada
- Sin rastros de `esNuevo`, `btn-soy-cliente`, `btn-soy-nuevo` ni de la línea
  "Ya casi…" que se eliminó de la tarjeta

🚨 **Sin probar todavía: el correo en Gmail de verdad, y las pantallas nuevas en un
navegador** (cancelación, tarjeta de Lince, portada de un solo botón).

---

## 8. Qué se desplegó hoy

| | |
|---|---|
| Migración `cancelacion_por_el_socio` | aplicada y verificada |
| Edge Function `notify-cita` | **versión 6**, activa, `verify_jwt = false` |
| Frontend | `build.py` → `index.html` (887 KB), en GitHub Pages |

---

## 9. Lo que sigue abierto

- **Punto 13** quedó sin piso: sin delegación, avisar al trabajador anterior de
  una reasignación ya no existe.
- **¿Se limpian las columnas en desuso?** `citas.asignado_a` y `perfiles.sede_id`.
  `trg_notificar_cita_delegada` **ya se eliminó hoy**, así que ese obstáculo para
  borrar `asignado_a` ya no está.
- **Nota menor:** el evento de Realtime de `citas` incluye `token_cancelacion` en
  su payload, y lo reciben admin y trabajadores. No es una fuga: el anónimo no
  recibe nada (RLS), el panel ignora el payload y vuelve a consultar, y quien lo
  recibe ya podía cancelar esa cita igual. Si molesta, se acota con
  `REPLICA IDENTITY`.

---

## 10. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **El HTML de los correos va en UNA línea** (`compactar()`). Con sangrado vuelven
   los `=20`.
4. **El asunto pasa SIEMPRE por `asuntoCabecera()`**, y su espacio inicial no se
   quita. Pasárselo crudo a denomailer rompe el correo entero.
5. **`citas.token_cancelacion` NO se expone jamás al frontend.** Nada de `select *`
   sobre `citas`: siempre columnas nombradas una por una.
6. **El plazo de cancelación lo decide la base, nunca el navegador.**
7. **`cancelada_por_origen` lo llena la base, nunca el frontend.**
8. **Al reescribir `notificar_cita()`, el WEBHOOK_SECRET se relee de la base.**
9. **Realtime solo emite lo que está en la publicación `supabase_realtime`**: hoy
   `citas`, `horarios_disponibles`, `sedes`, `perfil_sedes`. Suscribirse a otra
   tabla **no da error**, simplemente no llega nada.
10. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
11. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
12. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
    con `citas`.
13. **Sedes: todo sale de la base.** Ni la portada, ni el bloque "Próximamente",
    ni la tarjeta bloqueada pueden nombrar una sede a mano.
14. **Las sedes del trabajador salen de `perfil_sedes`**, nunca de
    `perfiles.sede_id`, que está en desuso.
15. **⚠️ `horarios_disponibles` se lee EN ABIERTO** (el socio ve los cupos), así que
    RLS **no** acota la lectura del trabajador. Recortarla a sus sedes lo hace el
    frontend, en `cargarHorarios()`.
16. **Las casillas de borrado en lote se acotan a `.grupo:not(.hidden)`.**
17. **Los requisitos de la evaluación los ve TODO el que reserva.** Ya no hay un
    camino corto que se los salte.
18. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
19. **Nada de lo que ya funciona puede dejar de funcionar.**
20. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
21. **El color de la sede nunca se usa como texto sobre blanco.**
21b. **El fondo vive en `body::before` con `position: fixed`, no en el `background`
    del body.** Si vuelve al body, en el móvil se estira con el contenido.
21c. **Las tarjetas de sede miden todas igual** (`grid-auto-rows: 1fr`), y lo que
    distingue a una sede cerrada es una pestaña POSICIONADA, no una línea más de
    texto. Añadir contenido al flujo de una tarjeta las vuelve a desparejar.
21d. **Los tamaños van con `clamp()`, no con saltos de breakpoint**, para que la
    página se acomode de forma continua al ancho.
21e. **⚠️ Nada de `filter: blur()` en el fondo.** Ya se probó y se ve sucio. Una
    foto de poca resolución se arregla subiéndola reescalada (LANCZOS + máscara
    de enfoque), no desenfocándola.
21f. **⚠️ El fondo va con `cover`, nunca con `contain`.** Ya se probó `contain` y
    dejaba la foto encajonada entre dos bandas blancas.
22. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
23. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
24. **Los correos de los trabajadores los manda la pestaña Usuarios.**
25. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64, así que cada KB del archivo son ~1,34 KB de página. Y
    se escribe a un temporal antes de reemplazar: una escritura a medias deja el
    archivo en cero bytes.
26. **Nada de emojis en la salida de los scripts de consola.** La consola de
    Windows es cp1252 y revienta con `UnicodeEncodeError` a mitad de la escritura.
