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
| **Siguiente** | Christopher — **cargar horarios de Lince** (hoy la sede existe pero está vacía) y probar con la cuenta de Luis |

## 🚨 Lo primero: Lince no tiene horarios

La sede está creada y ya aparece en la web, pero **sin horarios cargados nadie
puede reservar ahí**: el socio la elige y ve el calendario vacío. Hay que entrar
al panel como admin y cargarlos.

Todo lo demás está aplicado, construido, subido y verificado.

---

## 2. Cambios en la base

Tres, las tres ya corridas y verificadas.

### a) `citas_visibles_por_sede` — políticas RLS de `citas`

Archivo: `supabase/migraciones/2026-09-25-citas-por-sede.sql`.

El trabajador ya no ve "las citas que le asignaron" sino **las de su sede**:

```sql
-- se quitaron (modelo viejo, basado en la delegación ya eliminada)
using (es_admin() or (es_trabajador() and asignado_a = auth.uid()))

-- quedaron, para SELECT y para UPDATE
using (es_admin() or (es_trabajador()
       and (mi_sede() is null or sede_id = mi_sede())))
```

No se tocó el INSERT del socio anónimo, ni el DELETE (solo admin), ni ninguna
columna. `citas.asignado_a` sigue como historial.

**Verificado suplantando cada rol contra la base real:**

| Quién | Citas que ve | De otra sede |
|---|---|---|
| Admin (`sede_id` NULL) | **31** (todas) | — |
| Trabajador de Jesús María, activo | **25** | **0** |
| Trabajador **desactivado** | **0** | — |
| `anon` (el socio) | **0** | — |

### b) Tercera sede: Lince

Archivo: `supabase/migraciones/2026-09-25-sede-lince.sql`.

Fila nueva en `sedes`: `lince` · Sede Lince · Av. Petit Thouars 1860, Lince ·
color `#147362`, el teal del logo de BioFit, como pediste. Es dato, no
estructura, así que `supabase/schema.sql` no cambia.

⚠️ **Sus dos URLs de mapa no llevan lat/lng, llevan el nombre del local.** Del
link de `maps.app.goo.gl` que pasaste no salen coordenadas: redirige a una URL
con el nombre y un `ftid`. Inventar un pin cercano manda al socio a la cuadra
equivocada, así que las URLs buscan `XFLY Lince, Av. Petit Thouars 1860` y dejan
que Google lo resuelva. Comprobado antes de cargarlo: las dos responden 200 y la
del `output=embed` **no** trae `X-Frame-Options` en la respuesta final, igual que
las dos que ya funcionan. Si algún día consigues las coordenadas exactas, se
cambian con un `UPDATE` y el frontend las toma solo.

### c) El nombre del admin iba mal escrito

`perfiles.nombre` decía **"Luis Villayzán"**. Es **"Villayzan"**, sin tilde.
Corregido en la base y en `CLAUDE.md` y `README.md`, que eran los otros dos
lugares donde aparecía. No salía en ningún correo ni en el `index.html`.

```sql
update perfiles set nombre = 'Luis Villayzan'
where email = 'biofit.consulting1@gmail.com';
```

---

## 3. Qué cambió en el frontend

### 🩺 "Soy nuevo" ahora son los requisitos de la evaluación

La pantalla de bienvenida dejó de ser "cómo va a ser tu cita" y pasó a ser
**cómo prepararte**, con las 4 indicaciones en tarjetas con ícono:
Alimentación (ayunas o 2–3 h), Líquidos (nada 1 h antes), Ejercicio (ninguno
antes), Ropa (deportiva).

⚠️ **Ojo, esto era una contradicción:** los dos recordatorios del flujo nuevo
decían *"no necesitas venir en ayunas"*. Decían justo lo contrario de lo que
ahora se pide. Quedaron reescritos los dos (el del formulario y el de la
confirmación).

El botón **SOY NUEVO** de la portada ahora es idéntico al de **SOY SOCIO** —
antes era el secundario, con borde.

### 🔘 "Volver" y "Cambiar sede"

Pasaron de link plano a pastilla blanca con sombra, flecha en SVG y un hover que
desliza la flecha. La palabra queda como estaba: **"Volver"**, no "VOLVER".

El **"Volver" de la barra negra** (el de la pantalla de login) seguía siendo
texto suelto al lado de "Team Enterprise". Ahora es la misma pastilla fantasma
que su vecina, con la misma flecha. Con eso, `.link-btn` quedó sin usarse.

### 🖼️ Foto de fondo

`src/assets/portada-biofit.jpg` (Plaza Mayor de Lima) detrás de todo, bajo una
capa del color de fondo al **90 %**. Ese número se movió tres veces a pedido de
Christopher: 93 % → 95,5 % (se notaba demasiado) → **90 %**, que es donde quedó.
Es el único valor que hay que tocar si se quiere más o menos foto.

⚠️ **La foto original pesaba 2,2 MB y `build.py` incrusta las imágenes como data
URI.** Tal cual, hubiera dejado el `index.html` en ~3,8 MB. Se redujo a 1100 px y
calidad 55 → 131 KB. El `index.html` quedó en **968 KB** (antes 790 KB).

También se arregló `data_uri()` en `build.py`: mandaba `image/png` para todo, sin
mirar la extensión.

### 🏷️ "Ambas sedes" → "Todas las sedes"

Con 3 sedes, "ambas" ya no significaba nada. Cambió el texto y también el
centinela interno del `<select>`, que ahora es la constante `TODAS_LAS_SEDES`
exportada por `sedes.js`. En la base no cambia nada: sigue viajando como `NULL`.

### 📍 La portada ya no nombra sedes a mano

Decía *"Magdalena del Mar o Jesús María"* escrito en el HTML. Ahora la lista sale
de la base (`pintarSedesDePortada()` en `client.js`): al abrir Lince, el texto se
actualizó solo. La grilla de sedes pasó a `auto-fit` para que 3 tarjetas entren
bien.

---

## 4. Cómo se verificó

Con Playwright contra el `index.html` ya construido, apuntando a la base real.

- **Escritorio (1280 px) y celular (390 px)**, recorriendo Home → Soy nuevo →
  Sedes → Calendario
- **3 tarjetas de sede** con sus colores: amarillo, teal (Lince), verde
- El subtítulo de la portada salió *"Sesiones de 20 minutos en Jesús María, Lince
  y Magdalena del Mar"* — armado desde la base, no escrito a mano
- **Cero errores de consola** en todas las corridas
- En celular, `scrollWidth == viewport`: **no desborda de lado**
- `node --check` sobre cada módulo y sobre el bundle ya combinado
- Se encontró y arregló de paso: el aviso ⚠️ de la pantalla nueva se partía en
  tres pedazos, porque el texto suelto dentro de un contenedor `flex` genera un
  ítem por tramo. Va envuelto en un `<span>`

🚨 **Lo que sigue SIN probarse** (necesita las cuentas reales):

1. Que el trabajador vea las citas de su sede y ninguna de la otra **desde el
   navegador** — la política ya se comprobó en la base; falta que el panel la
   aproveche bien
2. Que al crear un trabajador de verdad le entren los correos de aviso
3. Crear y borrar horarios de verdad

---

## 5. Qué toca AHORA

1. **Cargar los horarios de Lince** desde el panel de admin. Sin eso, la sede
   existe pero no se puede reservar.
2. **Mirar el mapa de Lince en el celular** y confirmar que el pin cae en el
   gimnasio. Si no, pásame las coordenadas y las cambio con un `UPDATE`.
3. Con la cuenta de Luis: crear un trabajador, ver que aparece en Correos,
   cambiarle la sede, desactivarlo.
4. Con ese trabajador: que vea solo las citas de su sede.
5. Después: punto **10** de `TAREAS.md` (un clic), punto **11**, punto **17**.

---

## 6. Decisiones que dependen de Christopher

**1. ⚠️ El punto 8 de `TAREAS.md` dejó de ser hipotético.** Decía "anotado para
cuando abran una tercera sede" — y se abrió hoy. Un trabajador hoy solo puede
cubrir **una sede o las tres**. Si quieres a alguien en Magdalena y Jesús María
pero **no** en Lince, hoy no hay forma de decirlo. Arreglarlo es tabla intermedia
(`perfil_sedes`) + reescribir las RLS de horarios: no es una tarde. ¿Hace falta ya?

**2. El punto 13 quedó sin piso.** Sin delegación, avisar al trabajador anterior
en una reasignación ya no existe. Avisar de una cancelación sigue teniendo
sentido, pero el destinatario natural son los correos de la sede: **se funde con
el punto 7**. Confirmar antes de tocarlo.

**3. ¿Hace falta ver los horarios eliminados?** Hoy no se puede: al borrarlos
desaparece la fila. Implicaría archivar en vez de borrar, y eso toca la base.

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
7. **Migrar solo lo aprobado, avisando antes y dejándolo anotado acá después.**
   Aprobadas y todavía sin hacer: `citas.cancelada_por` (punto 7) y
   `citas.dni_cliente` nullable (punto 14).
8. **Nada de lo que ya funciona puede dejar de funcionar.**
9. Flujo: `editar /src` → `python build.py` → `git add -A` → `git commit` → `git push`.
10. **El color de la sede nunca se usa como texto sobre blanco**, y en el panel
    el calendario va con la paleta de la marca.
11. **El alta de horarios en lote usa `ignoreDuplicates: true`.**
12. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque esté
    cancelada.
13. **Los correos de los trabajadores los manda la pestaña Usuarios.**
14. **La sincronización de correos toca solo las filas de ese email.** Nunca
    barrer `notificaciones_sede` entera.
15. **Toda imagen nueva se comprime antes de entrar a `src/assets/`**: `build.py`
    las incrusta en base64 dentro del `index.html`, así que cada KB del archivo
    son ~1,34 KB de página.
