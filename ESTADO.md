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
| **Siguiente** | Christopher — **reservar una cita de prueba** para confirmar que el correo llega bien, y **cargar los horarios de Lince** |

## 🚨 Lo primero

**1. Los correos estaban rotos y ya se arregló. Falta confirmarlo con uno real.**
El correo que te llegó hoy 8:15 a.m. salió como texto crudo, con el `From`, el
`To` y los boundaries MIME a la vista. Está corregido y desplegado, pero **no se
probó contra Gmail**: haz una reserva de prueba y mira cómo llega.

**2. Lince sigue sin horarios.** Ahora la web ya no queda en blanco: muestra un
bloque **"Próximamente"**. Pero nadie puede reservar ahí hasta que los cargues.

**3. La cancelación por el socio está a medias.** La base ya está lista y
probada; **falta el frontend** (punto 5 de abajo).

---

## 2. Cambios en la base (hoy fue UNA, la que faltaba)

| Migración | Qué hizo |
|---|---|
| `cancelacion_por_el_socio` | Punto 15 de `TAREAS.md`, y cierra el 7 |

Estaba **escrita desde ayer pero sin correr**: Claude Code había perdido el
acceso a Supabase a mitad de aquella sesión. Hoy se recuperó el acceso, se
verificó que la base seguía intacta y se aplicó.

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

### Verificado contra la base, después de aplicarla

| Caso | Resultado |
|---|---|
| Columnas nuevas en `citas` | **4 de 4** |
| Citas confirmadas con token | **30 de 30** |
| Citas canceladas con token | **0 de 7** — correcto, no deben tener |
| `notificar_cita()` emite `CANCELADA` | sí |
| `verify_jwt` de la Edge Function | sigue en **false** |

### ⚠️ Tu decisión, ya aplicada: **2 horas**

Se puede cancelar **hasta 2 horas antes** de la cita. Pasado ese punto la
pantalla le dice al socio que escriba, y no cancela nada.

### ⚠️ El WEBHOOK_SECRET no pasó por el repositorio

`notificar_cita()` lleva el secreto embebido en su cuerpo y **el repo es
público**. La migración no lo reescribe a mano: lee el secreto de la función que
ya está en la base y lo vuelve a colocar. Se comprobó antes de correr nada que
el regexp lo encontraba. **Si algún día hay que tocar esa función, usar el mismo
truco.**

### ⚠️ Cancelar desde el panel AHORA manda correo

Antes no avisaba a nadie. Desde hoy, cancelar una cita (desde el panel o desde
el enlace del socio) manda un aviso a los correos de esa sede, diciendo **quién
canceló**. Eso es el punto 7, que estaba aprobado.

---

## 3. 🐛 El correo roto: qué pasó y por qué

El de hoy 8:15 a.m. ("Nueva cita: Mónica Rivera carranza — Sede Jesús María")
llegó con el asunto sin decodificar y **el mensaje entero como texto plano**:
se veían el `From`, el `To`, el `Date` y los `--attachment100` a la vista.

La culpa es de la librería SMTP (`denomailer@1.6.0`). Pasa el asunto por
`quotedPrintableEncodeInline()`, que arma **un solo** encoded-word
`=?utf-8?Q?...?=` con tres defectos encadenados:

1. deja los **espacios literales** dentro del encoded-word, cosa que RFC 2047
   prohíbe — por eso Gmail ni lo intenta decodificar y lo muestra crudo;
2. no lo corta en los **75 caracteres** que exige la norma;
3. y encima le mete **un salto de línea cada 74 caracteres SIN el espacio de
   continuación**.

El tercero es el que rompe el correo entero: ese salto parte la cabecera
`Subject` en dos, la segunda mitad (`da?=`) ya no tiene forma de cabecera, el
lector da por cerrada la zona de cabeceras ahí mismo, y **todo lo que sigue se
muestra como cuerpo**.

**Por qué no había pasado antes:** hace falta un asunto largo y con varias
tildes para cruzar los 74 caracteres. "Mónica Rivera carranza — Sede Jesús
María" tiene `ó`, `—`, `ú` e `í`, y cada uno pesa 2-3 bytes al codificar.

### Cómo se arregló

Una función nueva, `asuntoCabecera()`, arma la cabecera bien: encoded-words en
**Base64**, cortados en límites de carácter y plegados con **CRLF + espacio**,
que sí es la continuación válida. Si el asunto es ASCII corto, lo deja tal cual.

⚠️ **El espacio del principio no es un descuido.**
`quotedPrintableEncodeInline()` vuelve a codificar todo lo que empiece con
`"=?"`. Ese espacio se lo evita: ve ASCII puro que no empieza con `=?` y lo deja
pasar intacto. **Si alguien lo "limpia", el asunto se codifica dos veces.**

**Probado en aislado** con los 4 asuntos reales del sistema: el texto
decodificado vuelve idéntico al original, todo es ASCII, el encoded-word más
largo mide **60** (límite 75) y la línea más larga **70** (límite 78).

🚨 **Lo que NO se probó: cómo se ve en Gmail de verdad.** Eso solo lo confirma
una cita real. Es lo primero de tu lista.

---

## 4. Qué cambió en el frontend

### 🌱 Sede sin horarios: bloque "Próximamente"

Antes, entrar a Lince mostraba *"No hay horarios disponibles por ahora. Vuelve a
intentarlo más tarde."* — el mismo texto que una sede que se quedó sin cupos.
Son cosas distintas y ahora se ven distinto.

Lleva ícono de brote, la insignia **Próximamente**, el nombre de la sede, y un
botón **"Ver las otras sedes"** que devuelve al selector.

⚠️ **No dice "Lince" en ninguna parte del código.** Se decide preguntando si la
sede tiene **algún** horario cargado, sin filtrar por fecha ni disponibilidad.
Así que **desaparece solo** en cuanto cargues el primer horario de Lince, sin
tocar código ni desplegar. Y si mañana abre una sede nueva, le sale igual.

Hoy: Magdalena **82** horarios · Jesús María **283** · Lince **0**.

---

## 5. ⛔ Lo que falta para cerrar la cancelación

La base está lista y probada. Falta lo de arriba:

1. **El botón en el correo** de confirmación al socio, con su token
2. **La pantalla pública** de cancelación: ver la cita → confirmar → cancelada
3. Probarlo de punta a punta

Las dos funciones ya están listas para que las llame el frontend:

```
cita_por_token(token)            -> datos de la cita + puede_cancelar + motivo
cancelar_cita_por_token(token)   -> {"ok": true} | {"ok": false, "motivo": "..."}
```

⚠️ **El anónimo sigue sin poder leer ni editar `citas`.** Esas dos funciones son
la única puerta, y solo se pasa con el token. Ninguna devuelve el token, ni el
id de la cita, ni el correo o el teléfono del socio.

### Otras dos que siguen abiertas

- **Punto 13** quedó sin piso: sin delegación, avisar al trabajador anterior de
  una reasignación ya no existe.
- **¿Se limpian las columnas en desuso?** `citas.asignado_a` y
  `perfiles.sede_id`. Ninguna molesta y las dos son el camino de vuelta.
  `trg_notificar_cita_delegada` **ya se eliminó hoy**, así que ese obstáculo
  para borrar `asignado_a` ya no está.

---

## 6. Qué se desplegó hoy

| | |
|---|---|
| Migración `cancelacion_por_el_socio` | aplicada y verificada |
| Edge Function `notify-cita` | **versión 5**, activa, `verify_jwt = false` |
| Frontend | `python build.py` → `index.html` (998 KB) |

`node --check` pasó sobre los 11 módulos y sobre el bundle combinado.

---

## 7. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **El HTML de los correos va en UNA línea** (`compactar()`). Con sangrado
   vuelven los `=20`.
4. **El asunto de los correos pasa SIEMPRE por `asuntoCabecera()`**, y su espacio
   inicial no se quita. Pasárselo crudo a denomailer rompe el correo entero.
5. **Realtime solo emite lo que está en la publicación `supabase_realtime`**:
   hoy `citas`, `horarios_disponibles`, `sedes`, `perfil_sedes`. Suscribirse a
   otra tabla **no da error**, simplemente no llega nada.
6. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
7. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
8. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas`.
9. **Sedes: todo sale de la base.** Ni la portada ni el bloque "Próximamente"
   pueden nombrarlas a mano.
10. **Las sedes del trabajador salen de `perfil_sedes`**, nunca de
    `perfiles.sede_id`, que está en desuso.
11. **⚠️ `horarios_disponibles` se lee EN ABIERTO** (el socio ve los cupos), así
    que RLS **no** acota la lectura del trabajador. Recortarla a sus sedes lo
    hace el frontend, en `cargarHorarios()`.
12. **Las casillas de borrado en lote se acotan a `.grupo:not(.hidden)`.**
13. **`citas.token_cancelacion` NO se expone jamás al frontend**, ni en un
    `select *`. Es el secreto del enlace.
14. **`cancelada_por_origen` lo llena la base, nunca el frontend.** Si lo mandara
    el frontend, un trabajador podría decir que canceló el admin.
15. **Al reescribir `notificar_cita()`, el WEBHOOK_SECRET se relee de la base.**
    Nunca se escribe literal: el repo es público.
16. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
17. **Nada de lo que ya funciona puede dejar de funcionar.**
18. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
19. **El color de la sede nunca se usa como texto sobre blanco.** El bloque
    "Próximamente" usa `--sede-texto`, que ya viene oscurecido.
20. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
21. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
22. **Los correos de los trabajadores los manda la pestaña Usuarios.**
23. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64, así que cada KB del archivo son ~1,34 KB de página.
