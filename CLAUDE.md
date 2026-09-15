# BioFit — Sistema de Citas

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
| **Trabajador** | Sí | Ve y edita **solo las citas que el admin le delegó**. Gestiona horarios **solo de su sede asignada**. |
| **Administrador** (Luis) | Sí | Control total: citas, horarios, usuarios, configuración de correos, y delegar citas a trabajadores. |

---

## Base de datos — ESTADO REAL EN PRODUCCIÓN

> ⚠️ **La base de datos ya está construida, migrada y verificada.**
> No la modifiques. Si crees que falta algo, avisa antes de tocarla.
> `supabase/schema.sql` en el repo está DESACTUALIZADO — sirve solo como
> referencia histórica, no como fuente de verdad.

### `sedes`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `magdalena` \| `jesus_maria` |
| `nombre` | text | nombre visible de la sede |
| `direccion` | text | ubicación (gimnasios XFLY) |
| `color` | text | `#16a34a` verde (Magdalena) · `#eab308` amarillo (Jesús María) |

El color se lee **de la base**, no se hardcodea en el frontend.

### `horarios_disponibles`
`id` uuid PK · `sede_id` → sedes · `fecha` date · `hora` time ·
`disponible` bool · `created_at` timestamptz
Restricción única: `(sede_id, fecha, hora)`

### `citas`
`id` uuid PK · `horario_id` → horarios_disponibles · `sede_id` → sedes ·
`nombre_cliente` · `telefono_cliente` · `email_cliente` ·
`fecha` · `hora` · `estado` (`confirmada` \| `cancelada`) · `created_at` ·
**`asignado_a`** uuid → perfiles (nullable) — trabajador al que se delegó la cita

### `perfiles`
`id` uuid PK → `auth.users` · `email` · `nombre` ·
`rol` (`admin` \| `trabajador`) · `sede_id` → sedes (nullable) ·
`activo` bool · `created_at`

### `notificaciones_sede`
`id` uuid PK · `sede_id` → sedes · `email` · `activo` bool · `created_at`
Restricción única: `(sede_id, email)`

Correos que reciben el aviso interno cuando entra una cita. Varios por sede,
editables desde el panel por el admin.

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
| `citas` | **solo insertar** (no puede leer ninguna) | ver/editar **solo las asignadas a él**; **no puede borrar** | todo |
| `perfiles` | sin acceso | solo su propio perfil | todo |
| `notificaciones_sede` | sin acceso | sin acceso | todo |

La base rechaza cualquier cosa fuera de esto. Diseñar la UI para que coincida:
si un trabajador no puede borrar, **no mostrarle el botón de borrar**.

---

## Trampas conocidas del código actual

Dos bugs ya identificados. Corregirlos al modularizar:

**1. Horarios ocupados mal calculados para el trabajador.**
`cargarHorariosAdmin()` cruza `citas` para marcar qué slots están ocupados. Con RLS,
un trabajador solo recibe *sus* citas, así que los horarios ocupados por citas de
otros le aparecerían **libres** → riesgo de doble reserva.
→ Derivar "ocupado" de `horarios_disponibles.disponible`, no de cruzar con `citas`.

**2. Fecha en UTC en vez de hora local.**
`new Date().toISOString().slice(0, 10)` devuelve la fecha en UTC. En Perú (GMT−5),
después de las 7 pm eso da *mañana*, y los horarios de hoy desaparecen del panel.
→ Usar el helper `isoLocal()` que ya existe en el resto del archivo.

---

## Reglas de trabajo

1. **No modificar la base de datos.** Ya está construida y verificada.
2. **No romper el diseño.** La interfaz ya fue aprobada por el cliente: calendario
   estilo Google Calendar, tarjeta de login con la marca, paleta BioFit.
3. **Nunca poner la `service_role` key en el frontend.** El repositorio es público.
   Todo lo que necesite privilegios va en una Edge Function.
4. **La `anon key` sí puede ir en el frontend** — es su uso previsto, y RLS es lo
   que realmente protege los datos.
5. Español para todo lo que ve el usuario final (labels, mensajes, correos).

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

## Estado actual

**Hecho:**
- Base de datos completa: 5 tablas, 18 políticas RLS por rol, 4 funciones helper,
  2 triggers, todo verificado en producción
- Luis ya existe en Auth (`biofit.consulting1@gmail.com`) con perfil y rol `admin`
- 99 horarios cargados, 0 citas (base limpia de pruebas)
- Repo creado con GitHub Pages activo y `.nojekyll` en su sitio
- **Frontend modular completo y probado**: flujo del socio, panel por rol,
  gestión de usuarios, configuración de correos, colores por sede
- **Los dos bugs conocidos ya están corregidos** (ver sección anterior)
- Código fuente de las dos Edge Functions escrito (`notify-cita`, `crear-usuario`)

**Aún no existe:**
- Ninguna Edge Function **desplegada**. El código está en el repo, pero falta
  `supabase functions deploy` y configurar los Database Webhooks.
- Ningún usuario con rol `trabajador`: falta crear el primero y probar el
  aislamiento contra la base real.

**Pendiente:** ver `TAREAS.md`
