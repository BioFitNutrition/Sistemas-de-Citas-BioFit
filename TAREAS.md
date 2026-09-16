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

### Aclaración de diseño (importante, no cambiar el modelo)

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

## ✨ 6. Botón "Soy nuevo"

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

## 8. Sedes del trabajador: selección múltiple (a futuro)

Hoy un trabajador puede ser de **una sede** o de **todas** (`sede_id = NULL`).
Para 2 sedes alcanza perfecto.

A futuro, Luis quiere poder elegir **sedes específicas** — por ejemplo, alguien
que cubra 2 de 3 sedes. Eso ya no cabe en una sola columna.

⚠️ **Implicación técnica:** requiere una tabla intermedia (ej. `perfil_sedes`
con `perfil_id` + `sede_id`) para la relación muchos-a-muchos, y reescribir las
políticas RLS de `horarios_disponibles` para que consulten esa tabla en vez de
comparar contra `mi_sede()`.

**No hacerlo todavía.** Mientras BioFit tenga 2 sedes, el modelo actual
(una o todas) cubre todos los casos reales. Anotado para cuando abran una tercera.

---

## 9. Crear el primer trabajador y probar el aislamiento

Ya existen dos trabajadores de prueba en la base. Falta verificar en serio que:

- Solo ve las pestañas **Citas** y **Horarios**
- Ve **solo** las citas que le asignaron (después del arreglo del punto 1)
- En Horarios ve únicamente los de su sede
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

## 📧 13. Dos correos nuevos de delegación

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
