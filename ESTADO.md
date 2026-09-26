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
| **Fecha** | 25/09/2026 |
| **Última escritura** | Claude Code |
| **Siguiente** | Christopher — **responder la pregunta del punto 6** (plazo para cancelar) y **cargar los horarios de Lince** |

## 🚨 Lo primero

**1. Lince sigue sin horarios.** La sede existe y aparece en la web, pero sin
horarios nadie puede reservar ahí. Entra como admin y cárgalos.

**2. Falta una decisión tuya** para poder hacer la cancelación por parte del
socio: **hasta cuándo se puede cancelar**. Está en el punto 6.

**3. Revisa el reparto de sedes** de cada trabajador en Usuarios → Editar.

Todo lo demás está aplicado, construido, subido y verificado.

---

## 2. Cambios en la base (hoy fueron SEIS)

| # | Migración | Qué hizo |
|---|---|---|
| a | `citas_visibles_por_sede` | Las citas del trabajador salen de su sede, no de `asignado_a`. **Superada por (d)** esa misma tarde |
| b | Sede **Lince** | Fila nueva en `sedes`, color `#147362` (teal del logo) |
| c | Nombre del admin | `perfiles.nombre` decía "Villayzán"; es **"Villayzan"**, sin tilde |
| d | ⭐ `perfil_sedes_seleccion_multiple` | El trabajador pasa a gestionar **un conjunto** de sedes |
| e | `citas_dni_cliente` | Columna `dni_cliente text`, **nullable** |
| f | `realtime_sedes_horarios_perfil_sedes` | Realtime de verdad (ver abajo) |

Los archivos están en `supabase/migraciones/`, cada uno con su SQL de reversa.

### ⭐ Lo grande: `perfil_sedes` (punto 8 de `TAREAS.md`)

`perfiles.sede_id` era **una** columna: solo podía decir "esta sede" o NULL
("todas"). Con 3 sedes, *"Magdalena y Jesús María pero no Lince"* no se puede ni
escribir.

- Tabla nueva `perfil_sedes (perfil_id, sede_id)` — una fila por sede
- Función nueva `mis_sedes()`, reemplaza a `mi_sede()`
- **4 políticas reescritas**: `citas` ver/editar, `horarios` crear/editar, ahora
  con `sede_id in (select mis_sedes())`

⚠️ **`perfiles.sede_id` queda EN DESUSO**, igual que `citas.asignado_a`. No se
borró porque es lo único que permite revertir. `mi_sede()` sigue existiendo pero
**ya no la usa nada**.

⚠️ **El conjunto es EXPLÍCITO**, como decidiste: no hay un "todas" que se estire
solo. Al abrir una sede nueva, **nadie la gestiona** hasta que la marques.

⚠️ **Al revertir hay un paso que no se puede saltar.** Los trabajadores nuevos
tienen `sede_id` NULL, y en el modelo viejo NULL significa *todas las sedes*:
revertir sin rearmar esa columna primero **les abre el acceso a todo**. El SQL
está al final del archivo de migración.

### ⚡ Realtime: hasta hoy solo funcionaba a medias

⚠️ **La publicación `supabase_realtime` solo tenía `citas`.** Suscribirse a otra
tabla desde el frontend **no daba ningún error**: simplemente nunca llegaba nada.
Se agregaron `sedes`, `horarios_disponibles` y `perfil_sedes`.

Con eso: una sede nueva aparece sola en el panel y en la web del socio, los
horarios reflejan lo que haga otro usuario, y si le cambias las sedes a un
trabajador que está con el panel abierto, su pantalla se reacomoda sin que
vuelva a entrar. Al reconfigurar los selectores **se conserva el filtro** que
tenía elegido.

---

## 3. Cómo va el uso del Gmail: sobra muchísimo

Preguntaste si nos pasamos del plan gratis. **No, ni cerca.**

| | |
|---|---|
| Correos por cita hoy | **2** (1 aviso interno + 1 confirmación al socio) |
| Día de más movimiento (16/09) | 7 citas → **~14 correos** |
| Últimas 24 h | 1 cita, 2 correos, **ambos enviados sin error** |
| Límite de Gmail | ~**500 destinatarios al día** |

En tu día más cargado usaste cerca del **3 %** del límite. Los logs de la Edge
Function no muestran ni un fallo de envío.

Donde sí hay que mirar es cuando se hagan los **recordatorios automáticos**
(punto 17): ahí cada cita pasa a costar ~8 correos, y el margen baja a unas 60
citas diarias. Sigue siendo 30 veces tu volumen actual.

---

## 4. El "=20" del correo: arreglado

El HTML de los correos iba **indentado**, así que varias líneas terminaban en
espacios. Quoted-printable **obliga** a escribir un espacio final como `=20`, y a
Gmail en el celular le llegaban sin decodificar: salía un `=20` suelto arriba y
otro abajo del mensaje.

Se arregla en el origen: `compactar()` deja el HTML en **una sola línea** antes de
enviarlo. Medido: **2 líneas con espacio final antes, 0 después** — justo los dos
`=20` que se veían.

⚠️ **La función desplegada NO era igual a la del repo** (usaba otra librería SMTP
y tenía más logs). Se tomó **la desplegada** como base para no perder nada, y el
repo queda sincronizado con producción. Desplegada como **versión 4**, con
`verify_jwt = false` intacto (la llama un Database Webhook, que no manda JWT).

---

## 5. Qué cambió en el frontend

### 🧑‍🔧 Vista de editar trabajador

Botón **Editar** en cada trabajador → pantalla propia con **checks de sedes**,
**estado** (Activo/Inactivo) y **Guardar**. Un resumen en texto llano que se
actualiza al vuelo, y un aviso si desmarca todas. La lista quedó compacta con los
chips de sus sedes. El alta también pasó a checks y **exige al menos una sede**.

### 🧭 El panel del trabajador se explica solo

Abre con **"Tus sedes asignadas son:"** y sus chips, más una guía desplegable de
siete puntos: que solo ve lo de sus sedes, que puede deshabilitar pero **no**
borrar, que "reservado" no es "inhabilitado", que cancelar libera el horario solo,
que la lista se actualiza sola, y demás. Al admin no se le muestra.

### 🐛 El combo de sede del trabajador no filtraba

Estaba **fijado en "todas"** en el código para el trabajador, herencia de cuando
sus citas podían ser de cualquier sede. Con el selector ya visible para quien
tiene varias sedes, el resultado era un combo decorativo: lo viste elegir "Jesús
María" y seguir mostrando citas de Magdalena. **Arreglado.**

### 🗂️ Sub-pestañas en Citas y en Horarios

- **Citas**: `Próximas` · `Pasadas o canceladas`, con su contador
- **Horarios**: `Libres` · `Reservados` · `Inhabilitados` — antes reservado e
  inhabilitado iban juntos y son cosas distintas: uno lo tomó un socio, al otro
  lo apagaste tú

Solo se ve una a la vez, y dentro van **agrupadas por día y desplegables**.
Cambiar de sub-pestaña no vuelve a consultar la base.

⚠️ **Esto casi causó un accidente:** con secciones ocultas, "seleccionar todos
los visibles" marcaba también los de las otras sub-pestañas, y una pulsada a
Eliminar habría borrado horarios que nunca viste. El selector quedó acotado a la
sección abierta, y cambiar de sub-pestaña **limpia la selección**.

### 🪪 DNI del socio

Campo obligatorio de **8 dígitos** en el formulario, validado con mensaje claro.
Sale en la tarjeta del panel y en el correo de aviso interno. La columna es
nullable: las 31 citas anteriores no tienen DNI, así que la tarjeta no pinta la
línea cuando no hay.

### 🎛️ Todos los combo box iguales

Un solo estilo para los `<select>` del sistema, con `appearance:none` y flecha
propia. El nativo se dibuja distinto en cada navegador y en Windows quedaba gris
y cuadrado al lado del resto.

### 📅 El día elegido resalta toda su columna

En el celular se ven tres columnas juntas y el circulito del número no alcanzaba
para saber cuál era la tuya.

### 🖼️ Fondo

La capa sobre la foto de la Plaza Mayor bajó a **82 %**, en tres pasos a tu
pedido: 93 % → 95,5 % → 90 % → **82 %**. Es el único valor que hay que mover.

---

## 6. ⛔ Lo que falta y depende de ti

### La cancelación por parte del socio (punto 15)

Es lo que pediste: botón en el correo → pantalla con los datos de su cita →
confirma → se cancela, se avisa a los correos de la sede y el horario se reabre.

**Lo que ya está decidido y no hace falta preguntar:**

- El enlace lleva un **token aleatorio**, nunca el `citas.id` — los uuid no son
  secretos y con el id cualquiera cancelaría citas ajenas
- El token **se invalida al usarse**
- Avisa a los correos de `notificaciones_sede` de esa sede (que ya incluyen a
  sus trabajadores)
- El horario se libera **solo**: el trigger `trg_liberar_horario` ya lo hace
- **No** se abre `select` ni `update` de `citas` al anónimo: va por una función
  `SECURITY DEFINER` que recibe el token

**❓ Lo único que falta que decidas: hasta cuándo puede cancelar.** Sin límite,
alguien cancela 5 minutos antes y Luis se entera cuando ya perdió el turno. La
sugerencia escrita en `TAREAS.md` es **hasta 2 horas antes**, pero es tu negocio.

### Otras dos que siguen abiertas

- **Punto 13** quedó sin piso: sin delegación, avisar al trabajador anterior de
  una reasignación ya no existe. Avisar de una cancelación se **funde con el
  punto 7**.
- **¿Se limpian las columnas en desuso?** `citas.asignado_a` y
  `perfiles.sede_id`. Ninguna molesta y las dos son el camino de vuelta. Antes de
  borrarlas hay que quitar el trigger `trg_notificar_cita_delegada`.

---

## 7. Cómo se verificó

### Contra la base real, suplantando roles

| Caso | Resultado |
|---|---|
| Trabajador con solo `jesus_maria` | 25 citas, **0** de otra sede |
| Con `jesus_maria` + `magdalena` | **31** (25 + 6), 0 de Lince |
| Con solo `magdalena` | **6**, 0 de Jesús María |
| Desactivado · `anon` | 0 · 0 |
| Crear horario en sede que **no** tiene | **rechazado**, `42501` RLS |
| Crear horario en sede que **sí** tiene | pasó |

Las escrituras se corrieron en transacciones y se revirtieron.

### Con navegador (Playwright), PC y celular

- **Realtime de verdad**: página abierta, `UPDATE` en `sedes` disparado desde la
  base → **3 frames recibidos**, la página se repintó, cero errores
- **El filtro del trabajador**: "todas" → 2 sedes · "magdalena" → solo Magdalena
  · "jesus_maria" → solo Jesús María
- **DNI**: `"123"` y `"1234567a"` rechazados **sin insertar nada**; `"12345678"`
  manda `dni_cliente` correctamente. **No se creó ninguna cita real** (el insert
  se interceptó)
- **Horarios**: las 3 sub-pestañas, y "seleccionar todos los visibles" marcó 3
  (los 4 libres menos uno que tiene una cita cancelada apuntándolo) y **0 en las
  secciones ocultas**
- **El editor de trabajador**: al guardar salieron **exactamente** dos
  peticiones, `POST perfil_sedes` y `POST notificaciones_sede`. **El Gmail de
  BioFit no se tocó**
- El `=20`: probado en aislado, 2 líneas con espacio final antes y 0 después
- `node --check` sobre cada módulo y sobre el bundle combinado

🚨 **Lo que sigue SIN probarse:** el panel con las cuentas reales. No tengo las
claves, así que lo probé con las respuestas de Supabase interceptadas. Las
políticas sí están probadas contra la base. Falta juntarlo con un login de verdad.

### ⚠️ Un susto propio, para que quede escrito

Un script mío dejó **`panel.js` en 0 bytes**: abrí el archivo en modo escritura
(que trunca de entrada) y la escritura falló a mitad por un carácter que no se
podía codificar. Se restauró completo desde el último commit y se reaplicó el
cambio. **Regla nueva: preparar el contenido y validarlo ANTES de abrir el
archivo para escribir.**

---

## 8. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **El HTML de los correos va en UNA línea** (`compactar()`). Con sangrado
   vuelven los `=20`.
4. **Realtime solo emite lo que está en la publicación `supabase_realtime`**:
   hoy `citas`, `horarios_disponibles`, `sedes`, `perfil_sedes`. Suscribirse a
   otra tabla **no da error**, simplemente no llega nada.
5. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
6. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
7. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas`. El cruce solo dice POR QUÉ no está disponible y cuál no se puede
   borrar.
8. **Sedes: todo sale de la base.** Ni la portada puede nombrarlas a mano.
9. **Las sedes del trabajador salen de `perfil_sedes`**, nunca de
   `perfiles.sede_id`, que está en desuso.
10. **⚠️ `horarios_disponibles` se lee EN ABIERTO** (el socio ve los cupos), así
    que RLS **no** acota la lectura del trabajador. Recortarla a sus sedes lo
    hace el frontend, en `cargarHorarios()`. Si se quita, ve los de todas.
11. **Las casillas de borrado en lote se acotan a `.grupo:not(.hidden)`.** Si no,
    "todos los visibles" incluye lo que está en otra sub-pestaña.
12. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
    Aprobada y sin hacer: `citas.cancelada_por` (punto 7).
13. **Nada de lo que ya funciona puede dejar de funcionar.**
14. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
15. **El color de la sede nunca se usa como texto sobre blanco.**
16. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
17. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
18. **Los correos de los trabajadores los manda la pestaña Usuarios**, y la
    sincronización toca **solo** las filas de ese email.
19. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64, así que cada KB del archivo son ~1,34 KB de página.
