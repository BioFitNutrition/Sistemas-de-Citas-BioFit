# BioFit — Sistema de Citas

Sistema de agenda para las asesorías nutricionales de **BioFit Consulting**
(Luis Villayzan), en las sedes de Magdalena del Mar y Jesús María.

Reemplaza los links de Google Calendar Appointment Schedules por una sola URL
propia con la marca de BioFit. Todo corre en planes gratuitos.

---

## Cómo trabajar en este proyecto

El código que se edita vive **siempre** en `/src`. El `index.html` de la raíz es
un archivo **generado** — no lo edites a mano, se sobrescribe en cada build.

```
1. Editas lo que necesites en /src
2. python build.py          ← genera el index.html de la raíz
3. git add -A
4. git commit -m "lo que hiciste"
5. git push                 ← GitHub Pages se actualiza solo en 1-2 minutos
```

> ⚠️ Publica siempre con **Git**. Arrastrar archivos por la web de GitHub aplasta
> las carpetas y rompe las rutas del proyecto.

---

## Estructura

```
├── index.html              ← GENERADO por build.py (esto sirve GitHub Pages)
├── build.py                ← junta /src en un solo archivo
├── CLAUDE.md               ← contexto del proyecto (lo lee Claude Code)
├── TAREAS.md               ← pendientes
├── src/                    ← CÓDIGO FUENTE (aquí se trabaja)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/
│   │   ├── config.js           URL y anon key de Supabase, constantes
│   │   ├── supabaseClient.js   cliente compartido
│   │   ├── utils.js            helpers de fechas, toast, navegación
│   │   ├── sedes.js            sedes leídas de la base (nombre, dirección, color)
│   │   ├── auth.js             login, sesión y detección de rol
│   │   ├── client.js           flujo del socio (reservar)
│   │   ├── panel.js            panel interno (citas y horarios, según rol)
│   │   ├── usuarios.js         gestión de usuarios (solo admin)
│   │   ├── notificaciones.js   correos por sede (solo admin)
│   │   └── main.js             arranque
│   └── assets/             logo.png, logo-full.png, favicon.png
└── supabase/
    ├── schema.sql          documentación del esquema (NO ejecutar)
    └── functions/
        ├── crear-usuario/  crea trabajadores (valida que llame un admin)
        └── notify-cita/    envía los correos vía Gmail SMTP
```

---

## Cómo funciona

### Quién es quién

| Actor | ¿Inicia sesión? | Qué puede hacer |
|---|---|---|
| **Socio** | No | Reservar su cita desde la web pública. No tiene cuenta ni panel. |
| **Trabajador** | Sí | Ve solo las citas que le delegaron y los horarios de su sede. |
| **Administrador** | Sí | Todo: citas, horarios, usuarios, correos, y delegar citas. |

Los permisos se aplican en la **base de datos** (Row Level Security), no solo
ocultando botones. Aunque alguien llame la API directamente con su token, la
base rechaza lo que no le corresponde.

### La agenda no se puede sobre-reservar

Un trigger marca el horario como ocupado dentro de la misma transacción en que
se crea la cita. Si dos personas reservan el mismo minuto, la segunda recibe un
error y se le pide elegir otro horario. Al cancelar, el horario se libera solo.

---

## Puesta en marcha

### 1. Base de datos

Ya está creada y migrada en el proyecto de Supabase `snuefzvfhucgfllnifat`.
`supabase/schema.sql` es solo documentación; **no hay que ejecutarlo**.

### 2. Correos (Gmail)

BioFit no tiene dominio propio, así que los correos salen del Gmail de BioFit
vía SMTP. Hace falta una **contraseña de aplicación** de Google (requiere tener
la verificación en 2 pasos activada en esa cuenta).

```bash
supabase functions deploy notify-cita --no-verify-jwt

supabase secrets set GMAIL_USER=biofit.consulting1@gmail.com
supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
supabase secrets set WEBHOOK_SECRET=algo-largo-y-aleatorio
```

Luego, en el dashboard de Supabase → **Database → Webhooks**, crear dos:

| Webhook | Tabla | Evento | Para qué |
|---|---|---|---|
| `cita-nueva` | `citas` | Insert | Aviso interno + confirmación al socio |
| `cita-delegada` | `citas` | Update | Aviso al trabajador asignado |

Ambos apuntan a la URL de la función y llevan el header
`x-webhook-secret` con el mismo valor de `WEBHOOK_SECRET`.

### 3. Creación de trabajadores

```bash
supabase functions deploy crear-usuario
```

No necesita secretos adicionales: usa los que Supabase ya inyecta.

### 4. Publicación

GitHub Pages sirve la rama `main` desde la carpeta raíz. El `.nojekyll` evita
que GitHub procese el sitio con Jekyll.

---

## Notas para quien siga el proyecto

- La **anon key** en `src/js/config.js` es pública a propósito: está diseñada
  para ir en el frontend. Lo que protege los datos es RLS.
- La **service_role key** NUNCA va en el frontend. Todo lo que la necesita vive
  en una Edge Function.
- Las fechas se manejan con `isoLocal()`, nunca con `toISOString()`. En Perú
  (GMT−5) el segundo devuelve el día equivocado después de las 7 pm.
- Los colores de las sedes se leen de la columna `sedes.color`. Para cambiarlos
  se edita la base, no el código.
