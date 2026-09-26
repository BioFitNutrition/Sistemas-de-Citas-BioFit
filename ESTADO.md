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
| **Siguiente** | Christopher — **reservar una cita de prueba** (confirma el correo Y el botón de cancelar de una sola vez) y **cargar los horarios de Lince** |

## 🚨 Lo primero

**1. Haz una reserva de prueba con tu correo.** Es lo único que falta para cerrar
todo lo de hoy, y comprueba dos cosas a la vez:

- que el correo llega **bien formado** (hoy llegaba como texto crudo)
- que el botón **"Cancelar mi cita"** aparece y funciona de punta a punta

**2. Lince sigue sin horarios.** Ya no queda en blanco: muestra un bloque
**"Próximamente"**. Pero nadie puede reservar ahí hasta que los cargues.

Todo lo demás está aplicado, probado, desplegado y subido.

---

## 2. Cambios en la base (hoy fue UNA, la que faltaba)

| Migración | Qué hizo |
|---|---|
| `cancelacion_por_el_socio` | Punto 15 de `TAREAS.md`, y cierra el 7 |

Estaba **escrita desde ayer pero sin correr**: Claude Code había perdido el
acceso a Supabase a mitad de aquella sesión. Hoy se recuperó, se verificó que la
base seguía intacta y se aplicó.

El archivo, con su SQL de reversa, está en
`supabase/migraciones/2026-09-26-cancelacion-por-el-socio.sql`.

### Qué agregó

- **4 columnas en `citas`**: `token_cancelacion`, `cancelada_por`,
  `cancelada_por_origen`, `cancelada_en`
- **4 funciones**: `nuevo_token_cancelacion()`, `marcar_quien_cancelo()`,
  `cita_por_token()`, `cancelar_cita_por_token()`
- **2 triggers**: `trg_marcar_quien_cancelo`, `trg_notificar_cita_cancelada`
- **1 trigger eliminado**: `trg_notificar_cita_delegada`, que ya no se disparaba
  nunca porque nada vuelve a escribir `asignado_a`

Después se ejecutó además un `revoke` suelto: `nuevo_token_cancelacion()` había
quedado ejecutable por `authenticated`. No daba acceso a nada (genera un token
suelto, sin asociar a ninguna cita), pero era superficie de más.

### ⚠️ Tu decisión, ya aplicada: **2 horas**

Se puede cancelar **hasta 2 horas antes**. Pasado ese punto la pantalla le dice
al socio que escriba, y no cancela nada. **El plazo lo decide la BASE, no el
navegador**: si se validara en el frontend, bastaría con abrir la consola para
saltárselo.

### ⚠️ El WEBHOOK_SECRET no pasó por el repositorio

`notificar_cita()` lleva el secreto embebido y **el repo es público**. La
migración no lo reescribe a mano: lo lee de la función que ya está en la base y
lo vuelve a colocar. Se comprobó antes de correr nada que el regexp lo
encontraba. **Si algún día hay que tocar esa función, usar el mismo truco.**

### ⚠️ Cancelar desde el panel AHORA manda correo

Antes no avisaba a nadie. Desde hoy, cancelar una cita —desde el panel o desde
el enlace del socio— manda un aviso a los correos de esa sede diciendo **quién
canceló**. Eso es el punto 7, que ya estaba aprobado.

---

## 3. 🐛 El correo roto: qué pasó y por qué

El de hoy 8:15 a.m. ("Nueva cita: Mónica Rivera carranza — Sede Jesús María")
llegó con el asunto sin decodificar y **el mensaje entero como texto plano**: se
veían el `From`, el `To`, el `Date` y los `--attachment100` a la vista.

**No tuvo nada que ver con asignarte sedes.** Fue una cita real de Jesús María, y
te llegó porque estás en los correos de esa sede.

La culpa es de la librería SMTP (`denomailer@1.6.0`). Pasa el asunto por
`quotedPrintableEncodeInline()`, que arma **un solo** encoded-word
`=?utf-8?Q?...?=` con tres defectos encadenados:

1. deja los **espacios literales** dentro del encoded-word, cosa que RFC 2047
   prohíbe — por eso Gmail ni lo intenta decodificar y lo muestra crudo;
2. no lo corta en los **75 caracteres** que exige la norma;
3. y encima le mete **un salto de línea cada 74 caracteres SIN el espacio de
   continuación**.

El tercero es el que rompe el correo entero: ese salto parte la cabecera
`Subject` en dos, la segunda mitad (`da?=`, que se veía al inicio del cuerpo) ya
no tiene forma de cabecera, el lector da por cerrada la zona de cabeceras ahí
mismo, y **todo lo que sigue se muestra como cuerpo**.

**Por qué no había pasado antes:** hace falta un asunto largo y con varias tildes
para cruzar los 74 caracteres. "Mónica… — … Jesús María" tiene `ó`, `—`, `ú` e
`í`, y cada uno pesa 2-3 bytes al codificar.

### Cómo se arregló

Una función nueva, `asuntoCabecera()`, arma la cabecera bien: encoded-words en
**Base64**, cortados en límites de carácter y plegados con **CRLF + espacio**,
que sí es la continuación válida. Si el asunto es ASCII corto, lo deja tal cual.

⚠️ **El espacio del principio no es un descuido.**
`quotedPrintableEncodeInline()` vuelve a codificar todo lo que empiece con
`"=?"`. Ese espacio se lo evita: ve ASCII puro y lo deja pasar intacto. **Si
alguien lo "limpia", el asunto se codifica dos veces.**

---

## 4. La cancelación por el socio, completa

Ya está todo: base, correo y pantalla.

### El botón, en el correo de confirmación

Lleva el **token**, nunca el id de la cita. Debajo, en letra chica: *"Este enlace
es solo tuyo y deja de servir apenas lo uses."*

El enlace apunta a `…/Sistemas-de-Citas-BioFit/?cancelar=<token>`. La URL del
sitio está en la constante `SITIO_URL` de la Edge Function: **si algún día BioFit
compra un dominio, se cambia ahí y se redespliega**.

### La pantalla (`src/js/cancelar.js`, vista `view-cancelar`)

Cuatro estados: buscando · enlace inválido o fuera de plazo · la cita con
confirmación · cancelada.

- El botón destructivo **no** es el primario, y en el móvil "No, mantenerla"
  queda arriba
- El token **se borra de la barra de direcciones** apenas se usa: si no, viaja en
  el historial, en el Referer y en cualquier enlace que el socio copie
- Un token con formato inválido ni siquiera llega a la base

⚠️ **El anónimo sigue sin poder leer ni editar `citas`.** Se comprobó: como
`anon`, un `select` directo a `citas` devuelve **cero filas**. Las dos funciones
`SECURITY DEFINER` son la única puerta, y solo se pasa con el token. Ninguna
devuelve el token, ni el id de la cita, ni el correo o el teléfono del socio.

⚠️ **El token no se filtra al frontend.** Se auditó: el insert del socio no pide
`.select()`, así que nunca se le devuelve la fila; y los dos `select` del panel
nombran sus columnas una por una. **Si alguien escribe un `select *` sobre
`citas`, lo filtra.**

---

## 5. Cómo se verificó

### La base, contra producción

| Caso | Resultado |
|---|---|
| Columnas nuevas en `citas` | **4 de 4** |
| Citas confirmadas con token | **30 de 30** |
| Citas canceladas con token | **0 de 7** — correcto, no deben tener |
| `anon` puede ejecutar las 2 funciones | sí |
| `anon` puede leer `citas` | **no**, 0 filas |
| Token corto, inexistente o nulo | **0 filas** en los tres |
| Cita futura con margen | `puede_cancelar = true` |
| Cita pasada | `puede_cancelar = false` + motivo |

### El flujo completo de cancelación, **y revertido**

Se corrió dentro de un bloque que termina lanzando una excepción a propósito, así
que **no se canceló ninguna cita real ni salió ningún correo**:

| | |
|---|---|
| 1er intento | `{"ok": true}` |
| 2do intento con el mismo token | `{"ok": false, "motivo": "Este enlace ya no sirve…"}` |
| Estado final | `cancelada` |
| Origen | **`socio`** — el trigger no lo pisó, que era el punto delicado |
| Token quedó en NULL | sí |
| Horario liberado | **ocupado → libre**, solo |
| `cita_por_token` después | **0 filas** |

Comprobado después: 30 confirmadas, 7 canceladas, 0 con origen. Idéntico a antes.

### El asunto del correo

Probado en aislado con los 4 asuntos reales: el texto decodificado vuelve
**idéntico** al original, todo es ASCII, el encoded-word más largo mide **60**
(límite 75) y la línea más larga **70** (límite 78).

### El frontend

`node --check` sobre los 12 módulos y sobre el bundle combinado.

🚨 **Lo que sigue SIN probarse: cómo se ve en Gmail de verdad, y la pantalla de
cancelación en un navegador.** Las dos cosas las confirma una sola reserva de
prueba. Es lo primero de tu lista.

---

## 6. Qué se desplegó hoy

| | |
|---|---|
| Migración `cancelacion_por_el_socio` | aplicada y verificada |
| Edge Function `notify-cita` | **versión 6**, activa, `verify_jwt = false` |
| Frontend | `build.py` → `index.html`, subido a GitHub Pages |

---

## 7. Lo que sigue abierto

- **Punto 13** quedó sin piso: sin delegación, avisar al trabajador anterior de
  una reasignación ya no existe.
- **¿Se limpian las columnas en desuso?** `citas.asignado_a` y
  `perfiles.sede_id`. `trg_notificar_cita_delegada` **ya se eliminó hoy**, así
  que ese obstáculo para borrar `asignado_a` ya no está.
- **Nota menor:** el evento de Realtime de `citas` incluye `token_cancelacion`
  en su payload, y lo reciben admin y trabajadores. No es una fuga: el anónimo
  no recibe nada (RLS), el panel ignora el payload y vuelve a consultar, y quien
  lo recibe ya podía cancelar esa cita de todos modos. Si algún día molesta, se
  acota con `REPLICA IDENTITY`.

---

## 8. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **El HTML de los correos va en UNA línea** (`compactar()`). Con sangrado
   vuelven los `=20`.
4. **El asunto pasa SIEMPRE por `asuntoCabecera()`**, y su espacio inicial no se
   quita. Pasárselo crudo a denomailer rompe el correo entero.
5. **`citas.token_cancelacion` NO se expone jamás al frontend.** Nada de
   `select *` sobre `citas`: siempre columnas nombradas una por una.
6. **El plazo de cancelación lo decide la base, nunca el navegador.**
7. **`cancelada_por_origen` lo llena la base, nunca el frontend.** Si lo mandara
   el frontend, un trabajador podría decir que canceló el admin.
8. **Al reescribir `notificar_cita()`, el WEBHOOK_SECRET se relee de la base.**
   Nunca se escribe literal: el repo es público.
9. **Realtime solo emite lo que está en la publicación `supabase_realtime`**:
   hoy `citas`, `horarios_disponibles`, `sedes`, `perfil_sedes`. Suscribirse a
   otra tabla **no da error**, simplemente no llega nada.
10. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
11. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
12. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
    con `citas`.
13. **Sedes: todo sale de la base.** Ni la portada ni el bloque "Próximamente"
    pueden nombrarlas a mano.
14. **Las sedes del trabajador salen de `perfil_sedes`**, nunca de
    `perfiles.sede_id`, que está en desuso.
15. **⚠️ `horarios_disponibles` se lee EN ABIERTO** (el socio ve los cupos), así
    que RLS **no** acota la lectura del trabajador. Recortarla a sus sedes lo
    hace el frontend, en `cargarHorarios()`.
16. **Las casillas de borrado en lote se acotan a `.grupo:not(.hidden)`.**
17. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
18. **Nada de lo que ya funciona puede dejar de funcionar.**
19. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
20. **El color de la sede nunca se usa como texto sobre blanco.** El bloque
    "Próximamente" usa `--sede-texto`, que ya viene oscurecido.
21. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
22. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
23. **Los correos de los trabajadores los manda la pestaña Usuarios.**
24. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64, así que cada KB del archivo son ~1,34 KB de página.
