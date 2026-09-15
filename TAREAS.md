# BioFit — Pendientes

> El contexto del proyecto y el contrato de la base de datos están en `CLAUDE.md`.
> Leerlo primero.

El frontend modular ya está construido y probado. Lo que queda es **conectar los
correos, probar con datos reales y publicar**.

---

## 1. Desplegar las Edge Functions ⬅️ lo más importante

El código está escrito en `supabase/functions/`, pero **ninguna está desplegada
todavía**. Sin esto, no sale ningún correo y no se pueden crear trabajadores.

### 1a. `crear-usuario`

```bash
supabase functions deploy crear-usuario
```

No necesita secretos adicionales. Sin esto, el botón "Crear trabajador" del panel
va a fallar con un mensaje pidiendo desplegarla.

### 1b. `notify-cita`

Requiere una **contraseña de aplicación** de Google para el Gmail de BioFit
(hay que tener activada la verificación en 2 pasos en esa cuenta).

```bash
supabase functions deploy notify-cita --no-verify-jwt

supabase secrets set GMAIL_USER=biofit.consulting1@gmail.com
supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
supabase secrets set WEBHOOK_SECRET=algo-largo-y-aleatorio
```

Luego crear **dos** Database Webhooks (dashboard → Database → Webhooks), ambos
apuntando a la URL de la función, con el header `x-webhook-secret`:

| Nombre | Tabla | Evento | Dispara |
|---|---|---|---|
| `cita-nueva` | `citas` | Insert | Aviso interno + confirmación al socio |
| `cita-delegada` | `citas` | Update | Aviso al trabajador asignado |

**Verificar después:** reservar una cita de prueba y confirmar que llegan los dos
primeros correos; luego delegarla y confirmar que llega el tercero.

---

## 2. Crear el primer trabajador y probar el aislamiento

Todavía no existe ningún usuario con rol `trabajador`, así que la parte más
delicada del sistema no se ha probado contra la base real.

1. Desde el panel (como admin) → pestaña **Usuarios** → crear un trabajador
2. Entrar con esa cuenta y verificar que:
   - Solo ve las pestañas **Citas** y **Horarios**
   - No ve ninguna cita hasta que el admin le delegue una
   - Al delegarle una, aparece — y **solo esa**
   - En Horarios ve únicamente los de su sede
   - No puede eliminar nada

Vale la pena probar también el caso feo: pedirle a la API una cita que NO le
corresponde y confirmar que la base la rechaza.

---

## 3. Publicar

```bash
python build.py
git add -A
git commit -m "Frontend modular con roles, delegación y correos"
git push
```

Esperar 1-2 minutos y abrir el sitio. Refrescar con **Ctrl+F5** la primera vez.

**Verificar:** que el socio pueda reservar de punta a punta, y que Luis entre a
su panel y vea la cita.

---

## 4. Activar la protección de contraseñas filtradas

Un clic en el dashboard de Supabase → **Authentication → Policies** →
*Leaked Password Protection*. Compara las contraseñas contra HaveIBeenPwned.
Ahora que va a haber más de una cuenta, conviene tenerlo activo.

---

## Decisiones abiertas

Preguntar a Christopher antes de asumir:

### Texto de las sedes
En la base hoy dice `Sede Magdalena del Mar` / `Sede Jesus Maria`, y las
direcciones son `XFLY Magdalena del Mar` / `XFLY Jesus Maria`. Dos detalles:

- **"Jesus Maria" está sin tildes** y así se ve en la web. Conviene corregirlo.
- La dirección es el nombre del gimnasio. Para un socio que nunca ha ido, una
  dirección de calle real ("Av. Brasil 1234") le sirve mucho más para llegar.

Se cambia en la base (tabla `sedes`), no en el código.

### Correos de delegación
- Si el admin **reasigna** una cita de un trabajador a otro, ¿se avisa solo al
  nuevo, o también al anterior que ya no la tiene?
  *(Ahora mismo: solo al nuevo.)*
- Si se **cancela** una cita asignada, ¿se le avisa al trabajador?
  *(Ahora mismo: no se le avisa.)*

---

## Ideas para más adelante

No son urgentes, pero valen la pena cuando el sistema esté rodando:

- **Crear horarios en lote.** Hoy se agregan de a uno. Para cargar un mes
  completo es tedioso; un generador por rango de fechas y horas ahorraría mucho.
- **Recordatorio al socio** el día antes de su cita.
- **Vista de calendario para el panel**, en vez de la lista actual.
