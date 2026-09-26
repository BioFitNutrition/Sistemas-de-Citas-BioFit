# BioFit — Sistema de Citas

# 🛑 ANTES DE HACER NADA: LEE `ESTADO.md`

**Obligatorio, sin excepciones, en cada sesión.** `ESTADO.md` dice en qué punto
está el proyecto HOY, qué se cambió por última vez y qué toca ahora. Este archivo
(`CLAUDE.md`) es contexto permanente: cambia poco. `ESTADO.md` cambia siempre.

**Al terminar CUALQUIER cambio, regenera `ESTADO.md` completo** — reescrito de
cero, nunca agregando abajo. Es el último paso de todo trabajo, no es opcional.
Christopher mueve ese archivo entre Claude Code y el chat de Claude: si queda
desactualizado, el otro lado trabaja con información falsa.

---

> Archivo de contexto permanente del proyecto. Claude Code lo lee automáticamente
> al abrir el repositorio. Mantenerlo actualizado cuando cambie algo estructural.
>
> Las tareas pendientes están en `TAREAS.md`.

---

## Qué es este proyecto

Sistema de citas para **BioFit Consulting**, consultora de asesoría nutricional en
Lima, Perú. Cliente: **Luis Villayzán**.

Reemplaza los links de Google Calendar Appointment Schedules que usaba antes, con
una sola URL propia y con la marca de BioFit.

- Citas de **20 minutos**
- **2 sedes**, ubicadas dentro de gimnasios XFLY: Magdalena del Mar y Jesús María
- Volumen bajo: ~30 clientes, 7-10 citas por semana
- **Restricción dura: todo debe mantenerse en planes gratuitos** (Supabase free,
  GitHub Pages, Gmail). BioFit no tiene dominio propio.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML/CSS/JS puro, sin framework, sin bundler |
| Hosting | GitHub Pages — repo `BioFitNutrition/Sistemas-de-Citas-BioFit`, rama `main` |
| Base de datos / Auth / Realtime | Supabase, proyecto `snuefzvfhucgfllnifat` (región São Paulo) |
| Correos | Gmail SMTP de BioFit vía Edge Function (NO Resend — ver abajo) |

URL del proyecto Supabase: `https://snuefzvfhucgfllnifat.supabase.co`

**Por qué Gmail y no Resend:** BioFit no tiene dominio propio. Sin dominio
verificado, Resend solo permite enviar a la dirección de la propia cuenta, y el
sistema necesita escribirle también a los socios y a los trabajadores. Gmail SMTP
con "contraseña de aplicación" sí permite enviar a cualquier destinatario, gratis,
con un límite de ~500 correos/día (de sobra para este volumen).

---

## Los 3 actores

| Actor | ¿Inicia sesión? | Qué puede hacer |
|---|---|---|
| **Cliente / socio** | **No.** Acceso anónimo | Solo reservar una cita desde la web pública. No tiene registro, ni credenciales, ni panel. No construir login para él. |
| **Trabajador** | Sí | Ve y edita **las citas de su sede** (o de ambas si su `sede_id` es NULL). Gestiona horarios **solo de su sede**. Recibe por correo los avisos de su sede. |
| **Administrador** (Luis) | Sí | Control total: citas, horarios, usuarios, configuración de correos, y delegar citas a trabajadores. |

---

## Base de datos — ESTADO REAL EN PRODUCCIÓN

> **La base de datos la manejas TÚ** (desde 26/09/2026). Está construida,
> migrada y verificada; `supabase/schema.sql` es el volcado real y al día.
>
> Tres obligaciones al migrar, sin excepción:
> 1. Avisar a Christopher ANTES.
> 2. Actualizar `supabase/schema.sql` y esta sección en el mismo cambio.
> 3. Anotarlo en `ESTADO.md` bajo el título **"Cambios en la base"**, con el SQL
>    que corriste. Es lo único que ve Claude (chat): sin eso, trabaja con una
>    foto vieja y les da instrucciones contradictorias a los dos.
>
> ⚠️ El repo es PÚBLICO. Al volcar el esquema, nunca copies literal el cuerpo de
> `notificar_cita()`: lleva el WEBHOOK_SECRET embebido.

### `sedes`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `magdalena` \| `jesus_maria` |
| `nombre` | text | `Sede Magdalena del Mar` · `Sede Jesús María` |
| `direccion` | text | dirección de calle real |
| `color` | text | `#16a34a` verde (Magdalena) · `#eab308` amarillo (Jesús María) |
| `mapa_embed` | text | URL para el `<iframe>` del mini mapa |
| `maps_url` | text | link para el botón "Cómo llegar" |

**Todo esto se lee de la base, nunca se hardcodea en el frontend.** Si Luis se
muda de local, se cambia la fila y listo — no se toca código ni se hace deploy.

Valores reales hoy:

| | Magdalena | Jesús María |
|---|---|---|
| Dirección | Av. del Ejército 1360, Magdalena del Mar | Av. General Garzón 1123, Jesús María |

⚠️ **Los mapas NO usan API key de Google, a propósito.** La Maps Embed API oficial
exige una cuenta de facturación con tarjeta, y este proyecto no puede tener eso.
Se usan dos mecanismos sin key:

- `mapa_embed` → `https://www.google.com/maps?q=LAT,LNG(Etiqueta)&hl=es&z=17&output=embed`
- `maps_url` → `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`
  (este sí es API oficial y documentada de Google: Maps URLs)

**No reemplazar esto por la Embed API oficial.** Y el botón "Cómo llegar" no es
un adorno: si algún día el iframe deja de funcionar, es el que garantiza que el
socio igual pueda llegar.

### `horarios_disponibles`
`id` uuid PK · `sede_id` → sedes · `fecha` date · `hora` time ·
`disponible` bool · `created_at` timestamptz
Restricción única: `(sede_id, fecha, hora)`

### `citas`
`id` uuid PK · `horario_id` → horarios_disponibles · `sede_id` → sedes ·
`nombre_cliente` · `telefono_cliente` · `email_cliente` ·
`fecha` · `hora` · `estado` (`confirmada` \| `cancelada`) · `created_at` ·
`asignado_a` uuid → perfiles (nullable) — **en desuso**. Era la delegación cita
por cita, que se eliminó el 25/09/2026. La columna se deja como historial de lo
que ya estaba delegado; el frontend no la escribe ni la lee. Si un día se borra,
hay que quitar antes el trigger `trg_notificar_cita_delegada`.

### `perfiles`
`id` uuid PK → `auth.users` · `email` · `nombre` ·
`rol` (`admin` \| `trabajador`) · `sede_id` → sedes (nullable) ·
`activo` bool · `created_at`

### `notificaciones_sede`
`id` uuid PK · `sede_id` → sedes · `email` · `activo` bool · `created_at`
Restricción única: `(sede_id, email)`

Correos que reciben el aviso interno cuando entra una cita. Varios por sede,
editables desde el panel por el admin.

⚠️ **Los correos de los trabajadores los administra la pestaña Usuarios, no la
de Correos.** Al crear un trabajador se le da de alta en su sede (o en las dos);
al cambiarle la sede o desactivarlo, sus filas se reacomodan solas. Tocarlos a
mano desde la pestaña Correos funciona, pero el próximo cambio de sede los
vuelve a dejar como manda la ficha del usuario. Por eso esas filas salen
marcadas con "Se gestiona en Usuarios".

### Funciones helper (usables como RPC desde el frontend)

```
mi_rol()        -> 'admin' | 'trabajador'
es_admin()      -> boolean
es_trabajador() -> boolean
mi_sede()       -> sede_id asignada al usuario actual
```

Son `STABLE SECURITY DEFINER` con `search_path` fijado, filtran por `activo = true`,
y solo las puede ejecutar el rol `authenticated`. Se usan dentro de las políticas
RLS, por eso deben conservar su `GRANT EXECUTE` a `authenticated`.

### Triggers

- `trg_marcar_horario_ocupado` — al insertar una cita marca el horario como
  ocupado; lanza excepción si otro ya lo tomó (evita doble-booking)
- `trg_liberar_horario` — al cancelar una cita libera el horario

### Reglas RLS que la UI debe respetar

| Tabla | Público (anon) | Trabajador | Admin |
|---|---|---|---|
| `sedes` | leer | leer | leer + editar |
| `horarios_disponibles` | leer | leer; crear/editar **solo su sede**; **no puede borrar** | todo |
| `citas` | **solo insertar** (no puede leer ninguna) | ver/editar **las de su sede** (todas si `sede_id` es NULL); **no puede borrar** | todo |
| `perfiles` | sin acceso | solo su propio perfil | todo |
| `notificaciones_sede` | sin acceso | sin acceso | todo |

La base rechaza cualquier cosa fuera de esto. Diseñar la UI para que coincida:
si un trabajador no puede borrar, **no mostrarle el botón de borrar**.

---

## Trampas conocidas — YA CORREGIDAS, no reintroducirlas

Estas dos ya están arregladas en `/src`. Están documentadas porque son fáciles de
volver a romper sin darse cuenta:

**1. Horarios ocupados: derivarlos de `disponible`, NUNCA de cruzar con `citas`.**
Con RLS, un trabajador solo recibe *sus* citas. Si se calculara "ocupado" cruzando
contra `citas`, los horarios tomados por citas de otros le aparecerían **libres**
→ doble reserva. El estado ocupado sale de `horarios_disponibles.disponible`.

**2. Fechas: siempre `isoLocal()`, NUNCA `toISOString().slice(0,10)`.**
`toISOString()` devuelve la fecha en UTC. En Perú (GMT−5), después de las 7 pm eso
da *mañana* y los horarios de hoy desaparecen del panel. El helper `isoLocal()`
está en `utils.js`.

---

## Reglas de trabajo

1. **La base es tuya, pero se avisa antes y se deja registrado después**
   (ver la sección de base de datos). Migraciones ya aprobadas y pendientes:
   `citas.cancelada_por` (punto 7) y `citas.dni_cliente`, nullable (punto 14).
2. **Comentarios: los justos.** No llenes el código de comentarios explicando lo
   obvio. Se comenta solo lo que sorprende — una decisión contraintuitiva, una
   trampa que ya mordió. Si algo necesita tres párrafos, va en `ESTADO.md`.
3. **No romper el diseño.** La interfaz ya fue aprobada por el cliente: calendario
   estilo Google Calendar, tarjeta de login con la marca, paleta BioFit.
4. **Nunca poner la `service_role` key en el frontend.** El repositorio es público.
   Todo lo que necesite privilegios va en una Edge Function.
5. **La `anon key` sí puede ir en el frontend** — es su uso previsto, y RLS es lo
   que realmente protege los datos.
6. Español para todo lo que ve el usuario final (labels, mensajes, correos).

### Paleta de marca BioFit

```
teal oscuro   #147362   (color primario, botones)
teal claro    #42c4a8   (acentos)
lima          #88e300   (acentos)
negro         #0d0f0e   (header)
crema         #d4cbb9   (texto sobre fondo oscuro)
```

---

## Estructura del código

El código fuente vive en `/src`. El `index.html` de la raíz es **generado** por
`build.py` — no editarlo a mano.

```
src/js/
  config.js          constantes y credenciales públicas
  supabaseClient.js  cliente compartido
  utils.js           TODOS los helpers comunes (fechas, toast, navegación)
  sedes.js           sedes leídas de la base, con su color
  auth.js            login, sesión y detección de rol
  client.js          flujo del socio
  panel.js           panel interno: citas y horarios, adaptado al rol
  usuarios.js        gestión de usuarios (solo admin)
  notificaciones.js  correos por sede (solo admin)
  main.js            arranque
```

**Por qué `panel.js` y no `admin.js` + `trabajador.js`:** admin y trabajador ven
la misma pantalla de Citas y Horarios; lo que cambia es el alcance de los datos y
qué acciones aparecen. Un solo módulo que consulta el rol evita duplicar la
lógica de renderizado, y RLS respalda todo desde la base.

**Ojo con el build:** al combinar los módulos en un solo `<script>`, todos
comparten un mismo ámbito. Dos funciones privadas con el mismo nombre en archivos
distintos chocan. `build.py` detecta esas colisiones y aborta con un mensaje
claro antes de generar nada.

## El sistema está EN PRODUCCIÓN y funcionando

No es un prototipo. Está desplegado, con correos reales saliendo al Gmail de
BioFit. Cualquier cambio tiene que respetar lo que ya anda:

- Base de datos completa y verificada: 5 tablas, RLS por rol, 4 funciones helper,
  4 triggers
- Luis existe en Auth (`biofit.consulting1@gmail.com`) con rol `admin`
- **Las dos Edge Functions están DESPLEGADAS y ACTIVAS** (`notify-cita`,
  `crear-usuario`), con sus secretos y sus Database Webhooks configurados
- **Los correos funcionan y están probados en producción**: aviso interno,
  confirmación al socio, y aviso al trabajador cuando se le delega una cita
- Frontend modular publicado en GitHub Pages
- Existen 2 trabajadores de prueba en `perfiles`

⚠️ **`notify-cita` responde 200 de inmediato y manda el correo en segundo plano
con `EdgeRuntime.waitUntil`. NO cambiar ese patrón.** Conectarse a Gmail tarda
~6 s y quien la llama (pg_net) corta la espera a los 8 s: si respondiera al final,
el corte mataría la ejecución antes de enviar. Ya pasó una vez.

**Pendiente:** ver `TAREAS.md`. Lo que toca AHORA está en `ESTADO.md`.
