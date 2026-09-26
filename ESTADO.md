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
| **Siguiente** | Christopher — **cargar horarios de Lince** y probar el panel con las cuentas reales |

## 🚨 Lo primero

**1. Lince sigue sin horarios.** La sede existe y aparece en la web, pero sin
horarios nadie puede reservar ahí. Hay que entrar como admin y cargarlos.

**2. Revisa el reparto de sedes de cada trabajador.** La migración de hoy
convirtió lo que había, pero conviene mirarlo: entra a Usuarios → Editar y
confirma que cada uno tiene marcadas las que le tocan.

Lo demás está aplicado, construido, subido y verificado.

---

## 2. Cambios en la base

Hoy se corrieron **cuatro** cosas. Las dos primeras venían de la tanda anterior.

### a) `citas_visibles_por_sede` — las citas del trabajador salen de su sede

`supabase/migraciones/2026-09-25-citas-por-sede.sql`. Reemplazó el modelo viejo,
que ataba las citas a `citas.asignado_a` (la delegación, ya eliminada).
**Quedó superada esa misma tarde por el punto (d)**, pero se corrió y se verificó.

### b) Tercera sede: Lince

`supabase/migraciones/2026-09-25-sede-lince.sql`.
`lince` · Sede Lince · Av. Petit Thouars 1860, Lince · color `#147362`, el teal
del logo.

⚠️ **Sus URLs de mapa no llevan lat/lng, llevan el nombre del local.** Del link
de `maps.app.goo.gl` que pasaste no salen coordenadas, y un pin inventado manda
al socio a la cuadra equivocada. Buscan `XFLY Lince, Av. Petit Thouars 1860` y
Google lo resuelve — comprobado en producción: el mapa pinta con el rótulo
"Xfly Funcional Training - Lince". Si consigues las coordenadas exactas, se
cambian con un `UPDATE` y el frontend las toma solo.

### c) El nombre del admin

`perfiles.nombre` decía "Luis Villayzán". Es **"Villayzan"**, sin tilde.
Corregido también en `CLAUDE.md` y `README.md`.

### d) ⭐ `perfil_sedes_seleccion_multiple` — el cambio grande de hoy

`supabase/migraciones/2026-09-25-perfil-sedes.sql`. Es el **punto 8 de
`TAREAS.md`**, que abrir Lince volvió urgente.

**El problema:** `perfiles.sede_id` es UNA columna. Solo podía decir "esta sede"
o NULL ("todas"). Con 2 sedes alcanzaba; con 3, *"Magdalena y Jesús María pero
no Lince"* no se puede ni escribir.

| | |
|---|---|
| Tabla nueva | `perfil_sedes (perfil_id, sede_id)` — una fila por sede |
| Función nueva | `mis_sedes()`, `setof text`, reemplaza a `mi_sede()` |
| Políticas reescritas | **4**: `citas` ver/editar, `horarios` crear/editar |
| Se migró | sede concreta → 1 fila · NULL ("todas") → una fila por sede |

Las políticas ahora dicen `sede_id in (select mis_sedes())`.

⚠️ **`perfiles.sede_id` queda EN DESUSO**, igual que `citas.asignado_a`. No se
borró porque es lo único que permite revertir. Nadie la lee: ni el frontend ni
las políticas. `mi_sede()` sigue existiendo pero **ya no la usa nada**.

⚠️ **El conjunto de sedes es EXPLÍCITO**, y lo decidiste tú: no queda ningún
"todas" que se estire solo. Cuando abras una sede nueva, **nadie la gestiona**
hasta que entres y la marques.

⚠️ **Al revertir hay un paso que no se puede saltar.** Los trabajadores creados
de ahora en adelante tienen `sede_id` NULL, y en el modelo viejo NULL significa
*todas las sedes*: revertir sin rearmar esa columna primero **les abre el acceso
a todo**. El SQL para rearmarla está al final del archivo de migración.

---

## 3. Qué cambió en el frontend

### 🧑‍🔧 Vista de editar trabajador

En la pestaña Usuarios, cada trabajador tiene un botón **Editar** que abre una
pantalla propia (reemplaza a la lista, no se abre encima):

- **Checks de sedes** — se marcan las que gestiona: una, varias o todas
- **Estado** — Activo / Inactivo, que antes era un botón en la lista
- **Guardar cambios** / **Volver**
- Un resumen en texto llano que se actualiza al vuelo: *"Verá las citas y los
  horarios de X y Y, y recibirá por correo los avisos de esas sedes"*
- Si desmarca todas, avisa: *"Sin ninguna sede marcada no verá citas ni horarios"*

La lista quedó compacta: nombre, correo, chips de sus sedes con su color, estado
y el botón Editar. El alta también pasó a checks y **exige al menos una sede**.

### 🗂️ Citas: sub-pestañas y agrupadas por día

Las dos secciones ya existían, pero **apiladas**: para llegar al historial había
que recorrer todas las próximas. Ahora son **sub-pestañas** con su contador
—`Próximas 6` · `Pasadas o canceladas 5`— y solo se ve una. El cambio no vuelve a
consultar la base: las dos listas ya están en pantalla, solo se oculta una.

Dentro de cada una, las citas van **agrupadas por día y desplegables**, igual que
los horarios. Cerrado, un día ocupa una fila y ya dice lo esencial: qué día es,
cuántas citas hay, y la franja de horas o cuántas están canceladas.

- **Próximas**: días de más cercano a más lejano, el primero abierto
- **Historial**: días de más reciente a más viejo, **todos cerrados** (es para
  consultar, no para atender)
- Se recuerda qué días dejaste abiertos, para que un recargado por realtime no
  te los cierre en la cara

### 📅 El día elegido resalta toda su columna

Lo que pediste desde el celular. Antes solo se marcaba el numerito del día en la
cabecera; en el celular se ven tres columnas juntas y ese circulito no alcanzaba
para saber cuál era la tuya. Ahora la **columna entera** se tiñe con el color de
la sede, muy diluido, y las píldoras de hora siguen legibles encima.

### 🔧 El panel se adapta a varias sedes

| Sedes del trabajador | Qué ve |
|---|---|
| **Varias** | El filtro de sede aparece, con "Todas" + solo sus sedes |
| **Una** | El filtro se oculta (un selector de una opción no sirve) |
| **Ninguna** | Aviso claro en la cabecera: *"Todavía no tienes ninguna sede asignada"* |

---

## 4. Cómo se verificó

### Contra la base real, suplantando roles

| Caso | Resultado |
|---|---|
| Trabajador con solo `jesus_maria` | 25 citas, **0** de otra sede |
| Trabajador con `jesus_maria` + `magdalena` | **31** (25 + 6), 0 de Lince |
| Trabajador con solo `magdalena` | **6**, 0 de Jesús María |
| Trabajador **desactivado** | 0 |
| `anon` (el socio) | 0 |
| Crear un horario en una sede que **no** tiene | **rechazado**, `42501` RLS |
| Crear un horario en una sede que **sí** tiene | pasó |

Las pruebas de escritura se corrieron en transacciones y se revirtieron.

### Con navegador (Playwright), en PC (1280 px) y celular (390 px)

El flujo del socio, contra la base real. El panel, con las respuestas de Supabase
interceptadas y la sesión falsificada — no tengo las claves de las cuentas
reales, así que **el panel no se probó con credenciales de verdad**.

- Admin: lista con chips por sede, editor con los checks correctos, y al guardar
  **exactamente** dos peticiones: `POST perfil_sedes {magdalena}` y
  `POST notificaciones_sede {magdalena, ese correo}`. **El Gmail de BioFit no se
  tocó.**
- Citas: sub-pestañas con sus contadores, solo una sección visible, el cambio
  funciona, días agrupados (próximas ascendentes con el primero abierto;
  historial descendente y todo cerrado)
- Trabajador con 2 de 3 sedes: solo Citas y Horarios, filtro con "Todas + sus 2",
  y la consulta saliendo con `sede_id=in.(jesus_maria,magdalena)`
- Trabajador con 1 sede: filtro oculto · sin sedes: aviso visible
- Socio: la columna del día elegido resaltada, en PC y en celular
- `node --check` sobre cada módulo y sobre el bundle combinado
- Sin desborde lateral en celular y **cero errores de consola** en todas las corridas

**Tres cosas que se encontraron y se arreglaron así:**

1. En el alta, `.inline-form label` le ganaba a `.check-row` y ponía el check
   **encima** del texto en vez de al lado.
2. Un trabajador sin sedes generaba `sede_id=in.()`, que **PostgREST rechaza con
   400**. Ahora se corta antes de consultar y muestra el aviso.
3. Mi propia prueba del caso "sin sedes" no se estaba ejecutando (un `||` que
   trataba la cadena vacía como falsa). Corregida y vuelta a correr.

🚨 **Lo que sigue SIN probarse:** el panel con las cuentas reales. La simulación
cubre el render y qué peticiones salen; las políticas ya están probadas contra la
base. Falta juntar las dos cosas con un login de verdad.

---

## 5. Qué toca AHORA

1. **Cargar los horarios de Lince** desde el panel de admin.
2. **Revisar el reparto de sedes** de cada trabajador en Usuarios → Editar.
3. **Entrar con un trabajador de verdad** y confirmar que ve solo lo de sus sedes.
4. **Mirar el mapa de Lince en el celular** y confirmar que el pin cae bien.
5. Después: punto **10** de `TAREAS.md` (un clic), punto **11**, punto **17**.

---

## 6. Decisiones que dependen de Christopher

**1. El punto 13 quedó sin piso.** Sin delegación, avisar al trabajador anterior
en una reasignación ya no existe. Avisar de una cancelación sigue teniendo
sentido, pero el destinatario natural son los correos de la sede: **se funde con
el punto 7**. Confirmar antes de tocarlo.

**2. ¿Hace falta ver los horarios eliminados?** Hoy no se puede: al borrarlos
desaparece la fila. Implicaría archivar en vez de borrar, y eso toca la base.

**3. ¿Se limpian las columnas en desuso?** Quedan dos: `citas.asignado_a` y
ahora `perfiles.sede_id`. Ninguna molesta, y las dos son el camino de vuelta si
algo sale mal. Cuando pase un tiempo, se pueden borrar — antes hay que quitar el
trigger `trg_notificar_cita_delegada`.

---

## 7. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
4. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
5. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas`.
6. **Sedes: todo sale de la base** — nombres, direcciones, colores y mapas. Ni la
   portada puede nombrarlas a mano.
7. **Las sedes del trabajador salen de `perfil_sedes`**, nunca de
   `perfiles.sede_id`, que está en desuso. En las políticas,
   `sede_id in (select mis_sedes())`.
8. **⚠️ `horarios_disponibles` se lee EN ABIERTO** (el socio ve los cupos), así
   que RLS **no** acota la lectura del trabajador. Recortarla a sus sedes lo hace
   el frontend, en `cargarHorarios()`. No es cosmético: si se quita, el
   trabajador ve los horarios de todas las sedes.
9. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
   Aprobadas y todavía sin hacer: `citas.cancelada_por` (punto 7) y
   `citas.dni_cliente` nullable (punto 14).
10. **Nada de lo que ya funciona puede dejar de funcionar.**
11. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
12. **El color de la sede nunca se usa como texto sobre blanco**, y en el panel
    el calendario va con la paleta de la marca.
13. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
14. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
15. **Los correos de los trabajadores los manda la pestaña Usuarios.**
16. **La sincronización de correos toca solo las filas de ese email.** Nunca
    barrer `notificaciones_sede` entera.
17. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64, así que cada KB del archivo son ~1,34 KB de página.
