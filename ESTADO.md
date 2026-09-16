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
| **Fecha** | 15/09/2026 |
| **Última escritura** | Claude Code |
| **Siguiente** | Christopher — `git push` (queda **1 commit** sin subir) y probar el panel con la cuenta de Luis |

⚠️ **Falta subir 1 commit.** El del calendario compartido ya se publicó; el de
hoy (las dos secciones y el agrupado por día) todavía no.

```
(último)  Horarios del panel: dos secciones, agrupados por día, color de marca   ← SIN SUBIR
161bfcc   Calendario compartido: socio, alta en lote y borrado en lote           ← publicado
0f8a231   Arregla el bug del trabajador, mini mapa e interfaz                    ← publicado
```

---

## 2. Dónde estamos

El sistema **está en producción y funcionando**. No es un prototipo.

- Base de datos completa y verificada en Supabase (`snuefzvfhucgfllnifat`)
- Frontend modular publicado en GitHub Pages (un commit atrás, ver arriba)
- Las dos Edge Functions **desplegadas y activas** (`notify-cita`, `crear-usuario`)
- **Los correos funcionan y están probados en producción**
- 3 roles funcionando: socio (anónimo), trabajador, admin. RLS los separa de
  verdad, no solo ocultando botones

✅ **No hay bugs conocidos en producción.**

---

## 3. Qué cambió la última vez

**Solo frontend (`/src`). La base de datos no se tocó.** Tres cambios en la
pestaña **Horarios** del panel, todos pedidos por Christopher.

### 📂 La lista se partió en dos secciones

Antes iba todo mezclado y no se distinguía qué quedaba realmente libre:

| Sección | Qué lleva |
|---|---|
| **Libres** | creados y todavía reservables (`disponible = true`) |
| **Reservados o deshabilitados** | ya no se pueden reservar: o tienen una cita, o se deshabilitaron a mano |

Cada una con su propio contador. Dentro de la segunda, la etiqueta de cada fila
sigue diciendo si es **Ocupado** (tiene cita) o **Deshabilitado** (a mano).

⚠️ **Los horarios ELIMINADOS no se pueden listar:** al borrarlos se va la fila de
la base, no queda nada que mostrar. Si algún día hace falta el historial de
borrados, habría que agregar una columna de "archivado" en vez de borrar de
verdad — eso sí tocaría la base y hay que decidirlo aparte.

### 📅 Agrupados por día, desplegables

Una fila por horario llenaba la pantalla: una semana cargada son cientos. Ahora
**cada día es una sola fila** que se despliega para ver sus horas.

- La cabecera del día muestra la fecha, cuántos horarios tiene y la franja que
  cubre (`5:00pm – 6:20pm`), que es lo único que hace falta con el día cerrado
- Se abre el primer día de cada sección; el resto arranca cerrado
- **Se recuerda qué días dejaste abiertos**, para que recargar la lista (al
  habilitar un horario, o por realtime) no te los cierre en la cara
- Casilla por día para marcar todas sus horas de una vez, con estado "a medias"
  cuando solo algunas están marcadas. Su clic no abre ni cierra el desplegable
- Dentro del día, cada fila muestra la **hora** (`5:00 – 5:20pm`), no la fecha:
  la fecha ya está en la cabecera

### 🎨 El calendario del panel usa la paleta del sistema

Se teñía con el color de la sede y el amarillo de Jesús María no pegaba en una
pantalla interna. Ahora va siempre con el **teal de la marca (`#147362`)**,
elijas la sede que elijas.

El color por sede se queda donde sí sirve: **el calendario del socio** (lo orienta
sobre dónde va a ir) y **los chips de las listas** (identifican la sede de un
vistazo). Ahí sigue aplicando la regla de contraste: el color crudo va de fondo,
borde o punto, nunca de texto.

### Extra

Al habilitar o deshabilitar un horario ahora sale un aviso diciendo a qué sección
se movió. Sin eso, el horario simplemente desaparecía de donde estabas mirando.

### Archivos tocados

`src/js/panel.js` · `src/css/styles.css`
→ `python build.py` regeneró el `index.html` de la raíz (776 KB).

---

## 4. Cómo se verificó

Esta vez **sí se pudo probar la vista de administrador**, sin tocar la base: se
siembra una sesión en `localStorage` y se interceptan las respuestas de Supabase
con datos de prueba (Playwright). Eso cubre los caminos que antes quedaron sin
probar por no tener credenciales.

Con un juego de 9 horarios repartidos en 3 días (uno con cita confirmada, uno con
cita cancelada, uno deshabilitado a mano) se comprobó:

- Las dos secciones, con sus contadores: **Libres 6**, **Reservados o
  deshabilitados 3**
- El agrupado por día y las cabeceras: *"Domingo, 20 de setiembre · 4 horarios ·
  5:00pm – 6:20pm"*
- El primer día abierto y el resto cerrado
- 9 casillas, **2 deshabilitadas** con su motivo a la vista ("tiene una cita" /
  "cita cancelada en el historial")
- Las etiquetas de la segunda sección: Ocupado, Deshabilitado, Deshabilitado
- Marcar el día entero → "Eliminar 4 horarios"; marcar todos los visibles →
  "Eliminar 7 horarios" (los 9 menos los 2 bloqueados); marcar una sola hora deja
  la casilla del día **a medias**
- El calendario del panel se queda en `#147362` aunque se elija Jesús María
- Celular (390 px): **sin scroll horizontal**
- Sin errores de consola

También se repitió la regresión del **flujo del socio** contra la base real
(elegir sede → día → horario → formulario, sin reservar nada): sigue intacto, y
su calendario conserva el color de la sede.

🚨 **Lo que sigue SIN probarse contra la base real** (necesita la cuenta de Luis):

1. **Crear horarios de verdad** — el `INSERT` con RLS de admin y de trabajador
2. **El recuento "X creados, Y ya existían"** con datos reales
3. **El borrado en lote** ejecutándose de verdad
4. Que el **trabajador** no vea casillas ni botón de eliminar, y que vea la cita
   delegada de la otra sede (esto viene pendiente de dos tandas atrás)

La simulación cubre el render y la interacción, pero **no** las políticas RLS ni
los triggers: eso solo se confirma entrando con una cuenta real.

---

## 5. Qué toca AHORA

1. **`git push`** — queda 1 commit local sin subir.
2. **Entrar con la cuenta de Luis** y revisar los 4 puntos de arriba. Sugerencia:
   crear una tanda chica en una fecha lejana, ver el recuento, y borrarla con las
   casillas.
3. **Probar con un trabajador** — cierra el punto 9 de `TAREAS.md`.
4. Después: punto 6 ("Soy nuevo", el mini mapa ya está listo para reutilizarse),
   punto 11 ("¿Olvidaste tu contraseña?", el ojito ya está hecho), punto 10.
5. Cuando se toque la base: `cancelada_por` (puntos 7 y 13). **Avisar antes.**

---

## 6. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** El repo es público. Lo que necesite
   privilegios va en una Edge Function. La `anon key` sí va, es su uso previsto.
2. **No tocar el patrón de `notify-cita`**: responde 200 de inmediato y manda el
   correo con `EdgeRuntime.waitUntil`. pg_net corta a los 8 s y Gmail tarda ~6 s.
3. **Los mapas NO llevan API key de Google.** `output=embed` para el iframe y
   Maps URLs para el botón. **No "mejorarlo" a la API oficial.**
4. **Fechas con `isoLocal()`, nunca `toISOString().slice(0,10)`.**
5. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas`.
6. **Sedes: todo sale de la base** (nombre, dirección, color, mapa).
7. **No modificar la base de datos** salvo la migración ya aprobada.
8. **Nada de lo que ya funciona puede dejar de funcionar.**
9. Flujo de publicación: `editar /src` → `python build.py` → `git add -A` →
   `git commit` → `git push`. El `index.html` de la raíz es **generado**.
10. **La lista de citas del trabajador no se filtra por sede.**
11. **El color de la sede nunca se usa como texto sobre blanco.** Para texto va
    `--sede-texto` (o `colorLegible()`); el color crudo, solo de fondo, borde o
    punto. Y en el **panel** no se usa color de sede para el calendario: ahí
    manda la paleta de la marca.
12. **El alta en lote usa `ignoreDuplicates: true`.** Un upsert normal pisaría
    horarios existentes y puede provocar doble reserva.
13. **Un horario con cualquier cita apuntándolo no se puede borrar**, aunque la
    cita esté cancelada y el horario figure como libre: la FK `citas.horario_id`
    no tiene `ON DELETE`.

---

## 7. Decisiones que dependen de Christopher

Una sola, y sin apuro:

**¿Hace falta ver los horarios eliminados?** Hoy no se puede: al borrarlos
desaparece la fila. Si Luis quiere ese historial, la forma sería no borrar de
verdad sino marcarlos como archivados — eso **sí toca la base** (una columna
nueva) y hay que decidirlo antes de hacerlo. Mientras tanto, la sección
"Reservados o deshabilitados" cubre los otros dos casos que pediste: los que
tienen cita y los deshabilitados a mano.
