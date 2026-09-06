# BioFit — Sistema de Citas

Sistema propio de agenda para asesorías nutricionales (20 min) en las sedes
Magdalena del Mar y Jesús María. Reemplaza los 2 links de Google Calendar
Appointment Schedules.

**Stack:** HTML/CSS/JS puro (sin build) + Supabase (base de datos, auth,
realtime) + Resend (email) + GitHub Pages (hosting).

---

## 1. Estructura del proyecto

```
biofit-citas/
├── index.html
├── css/styles.css
├── js/
│   ├── config.js          ← acá van tu URL y anon key de Supabase
│   ├── supabaseClient.js
│   ├── utils.js
│   ├── client.js          ← flujo del cliente (reservar cita)
│   ├── admin.js           ← panel de Luis
│   └── main.js
├── assets/                ← logo.png va aquí
└── supabase/
    ├── schema.sql
    └── functions/notify-cita/index.ts
```

## 2. Configurar Supabase

1. Crea un proyecto nuevo en [supabase.com/dashboard](https://supabase.com/dashboard) (ya tienes cuenta).
2. Ve a **SQL Editor** → pega el contenido de `supabase/schema.sql` → **Run**.
   Esto crea las tablas, las políticas de RLS, los triggers y habilita
   Realtime para la tabla `citas`.
3. Ve a **Authentication → Users → Add user** y crea la cuenta de Luis
   (email + contraseña). No hay registro público: este es el único usuario
   que existirá, y es el "admin".
4. Ve a **Settings → API** y copia:
   - **Project URL**
   - **anon public key**

   Pégalos en `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```

   Es seguro exponer estos valores en el frontend — el control de acceso
   real lo hacen las políticas de RLS del `schema.sql` (públicos solo
   pueden leer horarios y crear citas; solo un usuario autenticado puede
   ver/cancelar citas o gestionar horarios).

## 3. Notificación por email (Resend + Edge Function)

Necesitas una cuenta gratis en [resend.com](https://resend.com) (3,000
emails/mes gratis) — con eso alcanza de sobra para ~30 clientes.

1. Crea la cuenta en Resend y genera una **API Key**.
2. (Opcional pero recomendado) Verifica tu dominio en Resend para poder
   enviar desde algo como `citas@biofit.pe`. Si no quieres verificar un
   dominio todavía, puedes usar el remitente de pruebas `onboarding@resend.dev`
   mientras tanto (solo llega a la bandeja del email verificado en tu cuenta
   de Resend).
3. Instala el [CLI de Supabase](https://supabase.com/docs/guides/cli) si no
   lo tienes, y desde la carpeta del proyecto:
   ```bash
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase functions deploy notify-cita --no-verify-jwt
   ```
4. Configura los secretos que usa la función:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set ADMIN_EMAIL=luis@example.com
   supabase secrets set RESEND_FROM_EMAIL=onboarding@resend.dev
   supabase secrets set WEBHOOK_SECRET=elige-un-secreto-largo-y-aleatorio
   ```
5. Copia la URL de la función que te dio el deploy (algo como
   `https://TU_PROJECT_REF.supabase.co/functions/v1/notify-cita`).
6. En el dashboard de Supabase, ve a **Database → Webhooks → Create a new
   webhook**:
   - **Table:** `citas`
   - **Events:** `Insert`
   - **Type:** `HTTP Request`
   - **URL:** la URL de la función del paso anterior
   - **HTTP Headers:** agrega `x-webhook-secret` con el mismo valor que
     pusiste en `WEBHOOK_SECRET`
7. Prueba reservando una cita de prueba desde el sitio — a Luis debería
   llegarle el correo en segundos.

## 4. Marca (logo y colores)

Cuando tengas el logo y los colores oficiales de BioFit:

1. Coloca el logo en `assets/logo.png` (se usa automáticamente en el
   encabezado; si no existe, simplemente no se muestra, sin romper nada).
2. Abre `css/styles.css` y reemplaza los valores en `:root` al inicio del
   archivo (son placeholders con un verde genérico ahora mismo):
   ```css
   --color-primary: #1f9d55;
   --color-primary-dark: #167a42;
   --color-accent: #ff8a3d;
   ```

## 5. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub y sube el contenido de esta carpeta
   (todo en la raíz del repo, o en `/docs` si prefieres).
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy
   from a branch** → elige la rama `main` y la carpeta (`/root` o `/docs`
   según dónde subiste los archivos).
3. En un par de minutos tu sitio estará en
   `https://tu-usuario.github.io/tu-repo/`.

No hay paso de build: es HTML/CSS/JS servido tal cual.

## 6. Flujo de uso

**Cliente:**
Home → "SOY CLIENTE" → elige sede → elige horario disponible → llena
nombre, apellidos, email, teléfono → confirma → ve pantalla de
confirmación. Luis recibe el email y ve la cita en tiempo real en su panel.

**Luis (admin):**
"Ingresar (Admin)" → login con su email/contraseña → pestaña **Horarios**
para habilitar nuevos horarios por sede/fecha/hora (o deshabilitar uno
libre) → pestaña **Citas** para ver todas las reservas (con filtro por
sede) y cancelarlas si hace falta — al cancelar, el horario se libera
automáticamente para que alguien más lo reserve.

## 7. Notas técnicas

- El doble-booking se evita a nivel de base de datos: un trigger marca el
  horario como ocupado dentro de la misma transacción del `insert`, y
  falla si alguien más ya lo tomó (el cliente ve un mensaje pidiéndole
  elegir otro horario).
- El panel de admin usa Supabase Realtime, así que si dos personas tienen
  el panel abierto, ambas ven los cambios al instante sin recargar.
- No hay panel de cliente ni edición de citas por el cliente, tal como se
  definió: cualquier cambio lo hace Luis desde su panel.
