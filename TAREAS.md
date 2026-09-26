# BioFit — Pendientes

> El contexto del proyecto y el contrato de la base de datos están en `CLAUDE.md`.
> Leerlo primero.

---

## ✅ Ya funcionando (no tocar)

- Base de datos completa con roles, RLS por rol, triggers anti doble-booking
- Frontend modular: flujo del socio, panel por rol, usuarios, correos, colores por sede
- **Las dos Edge Functions están desplegadas y ACTIVAS** (`notify-cita`, `crear-usuario`)
- **Los correos funcionan y están probados**: aviso interno + confirmación al socio
  salen correctamente por el Gmail de BioFit
- Los disparadores de correo (`trg_notificar_cita_nueva`, `trg_notificar_cita_delegada`)
  están creados y verificados

⚠️ **Nota sobre `notify-cita`:** responde 200 de inmediato y manda el correo en
segundo plano con `EdgeRuntime.waitUntil`. **No cambiar eso.** Conectarse a Gmail
tarda ~6 s y quien la llama (pg_net) corta la espera a los 8 s: si respondiera al
final, el corte mataría la ejecución antes de enviar. Ya pasó una vez.

---

## ✅ 1. BUG — Al trabajador no le aparece la cita asignada — HECHO (15/09/2026)

> Arreglado en `src/js/panel.js`. Falta la prueba con un trabajador real: ver
> `ESTADO.md`. La "Aclaración de diseño" de más abajo sigue siendo referencia
> permanente del modelo — no borrarla.

**Síntoma:** el admin le delega una cita al trabajador. El correo de aviso SÍ le
llega, pero al entrar a su panel no ve la cita.

**Causa ya diagnosticada (no hace falta investigar):**
En `panel.js`, a un trabajador se le fija el filtro de sede en *su* sede
(`llenarSelectSedes` con `soloSede: miSede()`), así que `cargarCitas()` termina
filtrando por esa sede. Si la cita delegada es de la OTRA sede, desaparece.

Verificado en producción: trabajador con sede `jesus_maria`, cita asignada de
`magdalena` → no la ve.

**El arreglo (y por qué):**
La lista de citas del trabajador **no debe filtrarse por sede nunca**. Debe
mostrarle todo lo que le asignaron, sin importar dónde — es perfectamente normal
que Luis le pida cubrir una cita puntual en la otra sede. RLS ya garantiza que
solo vea las suyas.

- En la pestaña **Citas**, para el trabajador: quitar el filtro de sede por completo
- En la pestaña **Horarios**, el filtro por sede sí tiene sentido y se queda
- Mostrar el chip de sede en cada cita, para que sepa a dónde ir

### Aclaración de diseño — ⚠️ SUPERADA el 25/09/2026

> Lo de abajo describía el modelo de delegación, que **se eliminó**. Hoy la sede
> del trabajador controla las dos cosas: qué horarios gestiona **y** qué citas
> ve (las de su sede), además de qué avisos recibe por correo. Se conserva el
> texto para entender por qué el código quedó como quedó.

La sede del trabajador (`perfiles.sede_id`) controla **una sola cosa**: qué
horarios puede gestionar. **No** limita qué citas puede recibir.

| | ¿Depende de `sede_id`? |
|---|---|
| Horarios que puede crear/editar | Sí — solo los de su sede (o todas si es NULL) |
| Citas que ve y atiende | **No** — solo las que el admin le delegue, de cualquier sede |

Es intencional: Luis debe poder pedirle a un trabajador que cubra una atención
puntual en la otra sede.

**Mejora de interfaz derivada de esto:** en el formulario de crear usuario, la
etiqueta "Sede" es ambigua (se lee como "solo atiende ahí"). Cambiarla por algo
como **"Sede que gestiona"** y agregar una nota corta aclarando que igual puede
recibir citas de cualquier sede.

---

## ✅ 2. Panel de admin — agregar horarios con calendario visual — HECHO (15/09/2026)

> Hecho con el componente `calendario.js`, compartido con la pantalla del socio.
> Calendario de varios días (clic y arrastre), franja horaria con selectores y
> AM/PM, intervalo fijo de 20 min, recuento previo y confirmación, duplicados
> saltados en silencio. Falta probarlo con sesión de admin: ver `ESTADO.md`.

Hoy son tres campos sueltos (sede / fecha / hora) y es tedioso. Luis quiere:

- **Calendario visual**, como el que ve el socio, en vez de escribir la fecha
- **Seleccionar varios días de una vez** (arrastrando o marcando varios)
- **Elegir AM/PM sin escribirlo**, con un selector en vez de teclear la hora

Objetivo de fondo: cargar la agenda de una semana o un mes completo sin repetir
el mismo formulario decenas de veces.

## 🔍 3. Revisar la generación de horarios — PARCIAL (15/09/2026)

Verificar que la creación de horarios esté funcionando bien en todos los casos
(fechas, duplicados, ambas sedes, el trigger de disponibilidad).

> Al rehacer el alta (punto 2) quedaron cubiertos por código y probados en
> navegador: fechas locales con `isoLocal()`, imposible elegir días pasados,
> duplicados saltados sin abortar la carga, y la sede elegida en el formulario.
> **Falta la pasada real con sesión de admin** contra la base.

## ✅ 4. Eliminar horarios en lote — HECHO (15/09/2026)

> Casillas por fila + "seleccionar todos los visibles" (respeta el filtro de
> sede), botón con el número y confirmación. Solo admin. Los horarios que tienen
> una cita apuntándolos van con la casilla deshabilitada y el motivo a la vista:
> la FK `citas.horario_id` no tiene ON DELETE, así que Postgres rechazaría el
> borrado — **incluso si la cita está cancelada**. Falta probarlo con sesión de
> admin: ver `ESTADO.md`.

Poder **seleccionar varios horarios con casillas** y borrarlos de una vez, en vez
de uno por uno.

⚠️ Recordar: RLS solo permite que **el admin** borre horarios. Al trabajador no
se le muestran esas casillas ni el botón.

---

## ✅ 5. Cambios de interfaz — HECHO (15/09/2026)

> Los cuatro (a, b, c, d) están implementados. El ojito quedó como helper
> reutilizable (`initTogglesPassword()` en `utils.js`) para el punto 11.

### a) "Admin" → "Team Enterprise"
El botón de arriba a la derecha debe decir **"Team Enterprise"** en vez de "Admin".

### b) Ocultar "Team Enterprise" dentro del panel
Una vez que el usuario inició sesión y está dentro del panel, ese botón **no debe
aparecer** arriba a la derecha. Solo debe quedar **"Cerrar sesión"**.

### c) Botones más atractivos
Mejorar el diseño de **"Cerrar sesión"** y **"Team Enterprise"** — hoy son links
planos y se ven pobres al lado del resto de la interfaz. Mantener la paleta BioFit.

### d) Ojito para ver la contraseña
En **todos** los campos de contraseña (login y creación de trabajadores), agregar
el ícono del ojito para mostrar/ocultar lo que se está escribiendo.

---

## ✅ 6. Botón "Soy nuevo" — HECHO (25/09/2026)

> Pantalla de bienvenida con la marca, los 4 pasos de cómo será la cita, y la
> elección de sede con las direcciones a la vista ("¿Qué sede te queda más
> cerca?"). Además, recordatorios extra en el formulario y en la confirmación.
> Mismo mecanismo y misma tabla que "SOY SOCIO".

Agregar un segundo botón en la pantalla de inicio, junto a "SOY SOCIO".

Hace casi lo mismo (elegir sede → horario → reservar), pero pensado para alguien
que **nunca ha venido a BioFit**:

- Una **bienvenida cálida a la marca** antes de pedirle datos
- Preguntarle **qué sede le queda más cerca** (con las direcciones a la vista para
  que pueda decidir)
- Los mismos horarios según la sede que elija
- **Explicarle los pasos** de cómo va a ser su cita, para que llegue sabiendo qué
  esperar

La diferencia con "SOY SOCIO" es el acompañamiento, no el mecanismo: al final se
guarda la misma cita en la misma tabla.

---

## 7. Correo cuando un TRABAJADOR cancela una cita

Hoy, si un trabajador cancela una cita que tenía asignada, nadie se entera. Luis
debe recibir aviso.

**Qué hacer:** al cancelarse una cita, si quien canceló fue un **trabajador**,
enviar correo a los destinatarios configurados en `notificaciones_sede` de esa
sede (ahí están el Gmail de BioFit y el correo personal de Luis), indicando
claramente **qué trabajador** la canceló y de qué cita se trata.

**No** avisar cuando el que cancela es el propio admin: él ya lo sabe. Pero **sí
registrar igual la auditoría** — se guarda quién canceló siempre, se envía correo
solo si fue un trabajador.

✅ **Decidido:** se agrega a `citas` la columna `cancelada_por uuid references
perfiles(id)`, que se llena con `auth.uid()` al cancelar. Resuelve el correo y
además deja rastro de auditoría de todas las cancelaciones.

| Quién cancela | Se guarda en `cancelada_por` | ¿Correo? |
|---|---|---|
| Trabajador | Sí | Sí → correos de `notificaciones_sede` de esa sede |
| Admin | Sí | No |

Esto SÍ requiere tocar la base de datos — coordinarlo antes de implementarlo.

---

## ✅ 8. Sedes del trabajador: selección múltiple — HECHO (25/09/2026)

> Se hizo el mismo día que abrió Lince, que es lo que lo volvió urgente: con 3
> sedes, una sola columna no podía decir "Magdalena y Jesús María pero no Lince".
>
> **Tabla nueva `perfil_sedes`** (una fila por sede) y **`mis_sedes()`** en vez de
> `mi_sede()`. Se reescribieron las 4 políticas RLS que dependían de ella (citas
> ver/editar, horarios crear/editar). `perfiles.sede_id` quedó **en desuso**.
> Migración y SQL de reversa en `supabase/migraciones/2026-09-25-perfil-sedes.sql`.
>
> El admin las reparte con **checks** en la vista **Editar trabajador** de la
> pestaña Usuarios, con su botón Guardar.
>
> ⚠️ **El conjunto es explícito, decidido por Christopher:** no hay un "todas"
> que se estire solo. Al abrir una sede nueva, **nadie la gestiona** hasta que el
> admin entre y la marque. Es más predecible, y nadie gana acceso a las citas de
> un local sin que alguien lo decida. Si alguna vez se quiere lo contrario, es un
> check extra que guarde "todas" como intención y no como lista.

## 9. Crear el primer trabajador y probar el aislamiento

⚠️ Actualizado el 25/09/2026: ya no hay delegación. La migración
`supabase/migraciones/2026-09-25-citas-por-sede.sql` **ya está aplicada**, y el
aislamiento por sede se comprobó contra la base suplantando roles (trabajador de
Jesús María: 25 citas, 0 de Magdalena). Falta la pasada con navegador y sesión
real.

Ya existen dos trabajadores de prueba en la base. Falta verificar en serio que:

- Solo ve las pestañas **Citas** y **Horarios**
- Ve **las citas de las sedes que gestiona**, y ninguna de las otras
- En Horarios ve únicamente los de esas sedes
- No puede eliminar nada
- Probar el caso feo: pedirle a la API una cita que NO le corresponde y confirmar
  que la base la rechaza

---

## 10. Activar la protección de contraseñas filtradas

Un clic en el dashboard de Supabase → **Authentication → Policies** →
*Leaked Password Protection*. Ahora que hay varias cuentas, conviene tenerlo.

---

## 🔑 11. "¿Olvidaste tu contraseña?" en el login

Hoy, si un trabajador olvida su contraseña, la única salida es que Luis le cree
otra cuenta. Hace falta recuperación por correo.

**Flujo:**

1. En la tarjeta de login, un link **"¿Olvidaste tu contraseña?"**
2. Pide el correo y manda el enlace de recuperación (`resetPasswordForEmail`)
3. El usuario **confirma desde su correo** — hasta ahí no puede cambiar nada
4. El enlace lo devuelve a la web, ya con sesión de recuperación, a una pantalla
   con dos campos: **"Nueva contraseña:"** y **"Repita la nueva contraseña:"**
5. Si coinciden, se guarda (`updateUser`) y entra al panel

⚠️ **Detalles que no hay que olvidar:**

- Los dos campos llevan el **ojito** del punto 5d
- Validar que coincidan **antes** de enviar, con mensaje claro
- El `redirectTo` debe apuntar a la URL de GitHub Pages **y** estar dado de alta
  en Supabase → **Authentication → URL Configuration → Redirect URLs**, si no el
  enlace del correo no funciona
- El correo lo manda Supabase Auth, **no** nuestra Edge Function: no hay que
  tocar `notify-cita`
- Esto sirve solo para admin y trabajadores. **El socio no tiene cuenta.**

---

## ✅ 12. Mini mapa de la sede — HECHO (15/09/2026)

> Implementado para el flujo "Soy socio". Cuando se haga el punto 6 ("Soy
> nuevo"), se reutiliza tal cual: la tarjeta ya se arma sola desde `sedes`.

Cuando el usuario elige una sede, junto con los horarios debe ver **dónde queda**.
Aplica tanto al flujo "Soy socio" como al nuevo "Soy nuevo" (punto 6), aunque en
"Soy nuevo" es donde más importa.

**La base ya tiene todo lo necesario. No hay que buscar nada ni hardcodear nada.**
La tabla `sedes` ahora trae dos columnas nuevas:

| Columna | Para qué |
|---|---|
| `mapa_embed` | va en el `src` de un `<iframe>` → el mini mapa |
| `maps_url` | va en el `href` de un botón **"Cómo llegar"** |

Ambas ya están pobladas para las dos sedes. `sedes.js` las expone igual que
`color` y `direccion` — se leen de ahí, nunca se escriben en el código.

**Qué mostrar al elegir sede:**

1. El nombre de la sede
2. La **dirección de calle** (ya es real: `Av. del Ejército 1360` /
   `Av. General Garzón 1123`)
3. El **mini mapa** en un iframe (`loading="lazy"`, bordes redondeados, que no
   rompa el layout en celular)
4. Un botón **"Cómo llegar"** que abre `maps_url` en pestaña nueva

⚠️ **Por qué son DOS cosas y no una:**

El mapa oficial de Google (Maps Embed API) exige **API key con cuenta de
facturación y tarjeta**. Este proyecto no puede tener eso. Así que el iframe usa
el formato `output=embed`, que funciona sin key pero **no es una API documentada**
— Google podría cambiarla.

El botón "Cómo llegar" sí usa la API oficial y documentada (Maps URLs), que no
necesita key. Es el respaldo: si algún día el iframe deja de cargar, el socio
igual puede llegar.

**No cambiar esto por la Embed API oficial.** Y si el iframe falla, que el mapa
no aparezca — pero el botón tiene que seguir ahí.

---

## 📧 13. Dos correos nuevos de delegación — ⚠️ HAY QUE REPENSARLO

> **La delegación se eliminó el 25/09/2026**, así que el punto (a) —avisar al
> trabajador anterior en una reasignación— ya no aplica: no hay reasignaciones.
>
> El punto (b) —avisar cuando se cancela una cita— sigue teniendo sentido, pero
> el destinatario cambia: ya no es "el trabajador asignado" sino los correos de
> `notificaciones_sede` de esa sede, que ahora incluyen a los trabajadores de la
> sede automáticamente. Es decir, **se funde con el punto 7**.
>
> Antes de implementarlo, confirmar con Christopher cómo queda.

Los dos son cambios en `notify-cita`. **No tocan la base** (fuera de
`cancelada_por`, que ya está en el punto 7).

### a) Reasignación — avisar al trabajador ANTERIOR

Si el admin le quita una cita al trabajador A y se la da a B, hoy **solo se le
avisa a B**. A se queda creyendo que la cita sigue siendo suya y puede
presentarse igual.

**Qué hacer:** en el `UPDATE`, si `old_record.asignado_a` existía y cambió,
mandarle correo también al anterior avisándole que **ya no tiene esa cita**.

Ya existe la lógica que detecta el cambio de `asignado_a` — es el mismo `if`.

### b) Cancelación de cita asignada — avisar al trabajador

Si se cancela una cita que estaba delegada, hoy el trabajador **no se entera por
correo**: solo la ve desaparecer del panel.

**Qué hacer:** al cancelarse una cita que tenía `asignado_a`, mandarle correo al
trabajador avisándole que se canceló.

⚠️ Esto es **independiente** del correo del punto 7. Pueden coincidir en un mismo
evento (un trabajador cancela su propia cita) — en ese caso sale el aviso a Luis
(punto 7) pero **no** tiene sentido avisarle al trabajador de algo que él mismo
hizo. Comparar contra `cancelada_por` antes de mandar.

---

## ✅ 14. Pedir DNI al agendar — HECHO (25/09/2026)

> Campo **DNI** en el formulario del socio, obligatorio, 8 dígitos exactos
> validados en el frontend con mensaje claro. Sale en la tarjeta de la cita del
> panel y en el correo de aviso interno.
>
> Columna `citas.dni_cliente text` **nullable**, como estaba previsto: las 31
> citas anteriores no tienen DNI y una columna `not null` habría roto la
> migración. La obligatoriedad vive en el formulario, no en la tabla — por eso
> la tarjeta del panel no pinta la línea del DNI cuando no hay.

## 🔗 15. Que el socio pueda cancelar su propia cita

Hoy, si un socio necesita cancelar, tiene que escribirle a Luis y que él lo haga
a mano. Se quiere que pueda hacerlo desde el correo de confirmación que ya recibe.

**Flujo:** en el correo de confirmación va un enlace → abre una pantalla del
sistema con los datos de su cita → botón "Cancelar mi cita" → confirma → la cita
pasa a `cancelada` y el horario se libera solo (el trigger ya hace eso).

### ⚠️ Lo que hay que resolver antes de programar esto

El socio **no tiene cuenta ni sesión**. Entonces el enlace es la única prueba de
identidad que existe, y ahí está todo el riesgo.

**El enlace NO puede llevar el id de la cita.** Los uuid no son secretos y el
`citas.id` aparece en más de un lado. Si el enlace fuera
`.../cancelar?id=<uuid de la cita>`, cualquiera que consiga o adivine un id
cancela la cita de otro. Peor: se podrían barrer citas ajenas a mano.

**Lo que hay que hacer:** una columna nueva `token_cancelacion`, un valor
aleatorio largo generado por la base (`gen_random_uuid()` o mejor 32 bytes
aleatorios), distinto del id. El enlace lleva **solo el token**.

**Y hace falta tocar RLS**, porque hoy el anónimo NO puede leer ni actualizar
citas — solo insertar. Se necesita:

- Una función `SECURITY DEFINER` que reciba el token, y solo si coincide
  exactamente, devuelva los datos mínimos de esa cita y permita cancelarla
- **No** abrir políticas de `select` o `update` a `anon` sobre `citas`. Eso
  expondría los datos de todos los socios

### Decisiones que faltan (preguntarle a Christopher)

- ¿Hasta cuándo se puede cancelar? Sugerido: hasta **2 horas antes**. Sin límite,
  alguien cancela 5 minutos antes y Luis se entera cuando ya perdió el turno
- ¿El token vence al usarse, o sigue sirviendo? Sugerido: se invalida al cancelar
- Cuando el socio cancela, ¿a quién se le avisa? Debería ir a los correos de
  `notificaciones_sede`, y al trabajador si la cita estaba asignada
- ¿Se guarda que canceló el socio? Encaja con `cancelada_por` del punto 7, pero
  ahí se guarda un `perfiles.id` y el socio no tiene perfil. Hace falta algo como
  `cancelada_por_socio boolean` o un texto de origen

**Esta es la funcionalidad más delicada del sistema hasta ahora**, porque es la
primera vez que alguien sin sesión puede MODIFICAR datos. Todo lo demás que hace
el anónimo es crear su propia cita. Vale la pena diseñarla despacio.

---

## 📅 16. Sincronizar las citas con el Google Calendar de Luis

Que la cita aparezca sola en el calendario de Luis, y que si se cancela en el
sistema **también desaparezca del calendario**. Con recordatorios **1 día antes**
y **3 horas antes**.

### Los tres caminos posibles

| | Costo | ¿Se cancela solo? | ¿Recordatorios exactos? | Complejidad |
|---|---|---|---|---|
| **A.** Archivo `.ics` en el correo | Gratis | A medias | **No** | Baja |
| **B.** API con OAuth | Gratis | Sí | Sí | Alta |
| **C.** API con cuenta de servicio | Gratis | Sí | Sí | Media |

**A — `.ics` adjunto.** El correo lleva el archivo, Luis lo abre y se agrega.
Para cancelar se manda otro `.ics` con el mismo `UID`, `METHOD:CANCEL` y
`SEQUENCE` mayor.
⚠️ **El problema:** Google Calendar **ignora los recordatorios (`VALARM`)** de
los `.ics` importados y aplica los del propio usuario. O sea: no hay forma de
garantizar el aviso a 1 día y 3 horas. Justo lo que Luis pidió.
Además, si Luis mueve o borra el evento a mano, se desincroniza y no hay vuelta.

**B — OAuth.** Funciona, pero hay que armar pantalla de consentimiento en Google
Cloud, y guardar un *refresh token* que puede caducar o revocarse. Si se cae, se
cae en silencio y nadie se entera hasta que faltan citas en el calendario.

**C — Cuenta de servicio (RECOMENDADO).** Se crea una cuenta de servicio en
Google Cloud y **Luis comparte su calendario con el correo de esa cuenta**, con
permiso de "Hacer cambios en los eventos". Listo.
- No hay pantalla de consentimiento
- **No hay token que caduque** — es lo que más pesa a largo plazo
- Permite `reminders.overrides` → los avisos de 1 día y 3 horas quedan exactos
- Crear, actualizar y borrar el evento, todo desde la Edge Function

### Qué hace falta para el camino C

**Migración:** columna `evento_calendar_id text` en `citas`. Sin guardar el id
del evento, después no hay cómo encontrarlo para cancelarlo.

**Secretos nuevos** en Supabase (NUNCA en el repo, que es público):
`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`.

**En la Edge Function:** firmar un JWT RS256 con la clave de la cuenta de
servicio, canjearlo por un access token, y pegarle a la API de Calendar. Deno lo
hace con Web Crypto, sin librerías extra.

**Eventos:**
- Cita nueva → crear evento, guardar su id en `evento_calendar_id`
- Cita cancelada → borrar el evento con ese id
- Cita reasignada → actualizar la descripción (quién atiende)

⚠️ **Zona horaria: `America/Lima`, explícita en cada evento.** Si se manda sin
zona, Google lo interpreta en la del calendario y la cita puede caer 5 horas
corrida. Es el mismo error de `toISOString()` pero en otro lado.

⚠️ **Si falla la sincronización, la cita NO debe fallar.** El calendario es un
extra. Si Google no responde, se guarda la cita igual y se registra el error.
Nunca al revés.

### Decisiones pendientes

- ¿En qué calendario? ¿El personal de Luis, el de BioFit, o uno nuevo compartido?
  Sugerido: **uno nuevo llamado "Citas BioFit"**, así no se mezcla con su agenda
  personal y lo puede apagar sin perder nada
- ¿Los trabajadores también deberían tener su cita en su calendario?
- ¿El socio recibe recordatorio también? Para eso alcanza un **link "Añadir a mi
  calendario"** en el correo de confirmación: gratis, trivial, y no necesita
  nada de lo anterior

---

## ⏰ 17. Recordatorios automáticos con `pg_cron`

**Hacer ESTO ANTES que el punto 16 (Google Calendar).** Resuelve el pedido real
—"avisarme 1 día antes y 3 horas antes"— sin depender de Google, y de paso
permite avisarle también al socio, que es donde se evitan los plantones.

`pg_cron` viene incluido en el plan gratis de Supabase. No hay servidor ni
servicio nuevo: se reusa la Edge Function de correo que ya funciona.

**La tarea, corriendo cada hora:**

1. Busca citas `confirmada` que caigan dentro de ~24 h y dentro de ~3 h
2. Por cada una, manda el recordatorio (a Luis y al socio)
3. **Marca esa cita como ya avisada**
4. Se duerme hasta la hora siguiente

**Migración:** dos columnas en `citas`, `recordatorio_24h_enviado` y
`recordatorio_3h_enviado` (timestamptz o boolean). Son dos marcas separadas, no
una: son dos avisos distintos en momentos distintos.

⚠️⚠️ **EL PASO 3 NO ES OPCIONAL.** Sin la marca, el cron corre cada hora y
reenvía el mismo recordatorio: 10 citas activas × 24 corridas = **240 correos
por día**. El límite de Gmail son **500 destinatarios diarios**, y al pasarlo
**Gmail corta TODOS los correos del sistema hasta 24 horas** — incluida la
confirmación al socio y el aviso de cita nueva a Luis. La web sigue funcionando
sin dar ningún error: las citas se guardan, los correos simplemente no salen.

⚠️ No mandar recordatorio de citas `cancelada`, ni de citas que ya pasaron.

### Consumo de correos (por qué hay margen de sobra)

| Escenario | Correos por cita | Citas/día hasta el límite |
|---|---|---|
| Hoy, sin delegar | 3 | 166 |
| Hoy, delegando | 4 | 125 |
| Con recordatorios | 8 | **~62** |

Luis hace hoy 1-2 citas por día. Hay unas 35 veces el volumen actual de margen.
Recién pasando las **30 citas diarias sostenidas** conviene comprar dominio y
pasar a un servicio de correo real — no porque Gmail falle, sino porque a ese
volumen los envíos automáticos desde una cuenta personal caen en spam.

---

## 💬 18. Ventanas de confirmación propias (message box)

Hoy las confirmaciones salen con el cuadro nativo del navegador (`confirm()`).
Se ve como un aviso de Chrome, no como BioFit, y desentona con todo lo demás.

### a) Un componente reutilizable, uno solo

Una función en `utils.js` que devuelva una promesa, usada en TODOS lados:

```
const ok = await confirmar({
  titulo: "...",
  mensaje: "...",
  textoSi: "Sí, asignar",
  textoNo: "No",
  peligro: true   // botón en rojo para acciones destructivas
});
```

⚠️ Cuidado con el nombre: `build.py` aborta si dos módulos declaran el mismo
identificador. Elegir uno que no exista ya.

**Dónde reemplazarlo:** cancelar una cita, deshabilitar un horario, eliminar
horarios (uno y en lote), desactivar un usuario. En todo lo que hoy use
`confirm()` o `alert()`.

**Detalles que no hay que saltarse:**

- **Esc** y **clic afuera** cierran = cancelar
- El foco arranca en el botón **seguro**, nunca en el destructivo. Si alguien
  aprieta Enter por reflejo, que no borre nada
- Acciones destructivas con el botón en rojo; las demás, en la paleta BioFit
- Que funcione en celular (no un modal de 600px fijos)

### b) Aviso al asignar una cita de otra sede

**Decisión tomada:** asignarle a un trabajador una cita de otra sede **sigue
permitido**. Luis tiene 2 sedes a 15 minutos, de la misma cadena de gimnasios;
pedirle a alguien que cubra una atención puntual en la otra es normal. No se
bloquea — se avisa.

Al asignar, si el trabajador tiene una sede fija **distinta** a la de la cita:

> **Esta trabajadora es de la sede Jesús María.**
> ¿Seguro que querés asignarle una cita de Magdalena del Mar?
> **[Sí, asignar] [No]**

- Si el trabajador es de **"Ambas sedes"** (`sede_id = null`) → **no sale nada**
- Si la sede **coincide** → tampoco sale nada
- Usar el nombre real de la persona y de las sedes, no textos genéricos

⚠️ **Esto es una red de seguridad contra el clic distraído, NO un control de
acceso.** Es solo interfaz: no impide que alguien llame la API directamente y
asigne igual. Está bien que así sea — decidimos no bloquearlo. Pero que nadie
lo confunda con una restricción real.

---

## ⚠️ Regla que aplica a TODOS los pendientes

Ninguno de estos cambios puede romper lo que ya funciona. Lo que hoy está en
producción y andando —reservar una cita, los correos, el panel, los roles, el
anti doble-booking— **tiene que seguir funcionando igual** después de cada
mejora. Ante la duda entre una mejora vistosa y no tocar algo que funciona,
gana no tocarlo.

---

## ✅ Decisiones ya cerradas (no volver a preguntarlas)

- **Tildes de las sedes** → corregido en la base. Ya dice `Sede Jesús María`.
- **Direcciones reales** → cargadas en la base (ver punto 12).
- **Reasignación de cita** → SÍ se avisa al trabajador anterior (punto 13a).
- **Cancelación de cita asignada** → SÍ se avisa al trabajador (punto 13b).

---

## Recordatorio del flujo de trabajo

```
editar /src  →  python build.py  →  git add -A  →  git commit  →  git push
```

`build.py` aborta si dos módulos declaran el mismo nombre — al combinarlos en un
solo `<script>` comparten ámbito y chocarían en el navegador.
