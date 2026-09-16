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
| **Siguiente** | Christopher — hacer `git push` y probar el panel con sesión de admin |

⚠️ **Hay un commit hecho y SIN SUBIR.** El push quedó pendiente a propósito.

---

## 2. Dónde estamos

El sistema **está en producción y funcionando**. No es un prototipo.

- Base de datos completa y verificada en Supabase (`snuefzvfhucgfllnifat`)
- Frontend modular publicado en GitHub Pages
- Las dos Edge Functions **desplegadas y activas** (`notify-cita`, `crear-usuario`)
- **Los correos funcionan y están probados en producción**
- 3 roles funcionando: socio (anónimo), trabajador, admin. RLS los separa de
  verdad, no solo ocultando botones

✅ **No hay bugs conocidos en producción.**

---

## 3. Qué cambió la última vez

**Claude Code tocó SOLO el frontend (`/src`) y `build.py`. La base de datos no se
tocó** — solo se consultó para confirmar el contrato (FK, políticas, defaults).

Tanda de tres partes, unidas por un mismo componente de calendario nuevo.

### 🆕 `src/js/calendario.js` — el componente compartido

El mini calendario vivía incrustado en `client.js`, atado a ids fijos del HTML.
Se extrajo a un componente que se monta sobre un contenedor vacío y se pinta
solo, así que puede haber dos en la misma página sin pisarse:

- **modo `"uno"`** → el socio elige el día de su cita
- **modo `"varios"`** → el panel marca varios días (clic para marcar/desmarcar y
  arrastre con el mouse)

En pantallas táctiles el arrastre queda fuera **a propósito**: capturarlo
impediría desplazar la página con el dedo sobre el calendario. Ahí se marca
tocando, que funciona igual.

También trae `serieDeHoras(inicio, fin, paso)`, que genera la serie de una franja
(5:00pm→7:00pm da 5:00, 5:20, 5:40, 6:00, 6:20, 6:40). La última cita **termina**
dentro de la franja, no empieza al final.

### 🎨 Regla de color, resuelta de una vez

El color de cada sede lo carga Luis en la base y puede ser cualquiera. El amarillo
de Jesús María (`#eab308`) sobre blanco da **1.92:1**: como texto es ilegible.
En vez de una lista de excepciones, `utils.js` ahora deriva las variantes:

| Variante | Para qué |
|---|---|
| `--sede-color` | el color crudo → **solo fondo, borde o punto** |
| `--sede-suave` | aclarado con blanco → fondo de los días con cupo |
| `--sede-texto` | oscurecido hasta pasar 4.5:1 → **la única que va de texto** |
| `--sede-contraste` | negro o blanco → texto **encima** del color sólido |

Con el amarillo, el texto termina siendo `#8e6d05` (4.84:1) y el relleno del día
elegido es el amarillo real con texto casi negro (10.9:1). Sirve para cualquier
color que Luis cargue mañana, sin tocar código.

**De paso se arregló un caso real que estaba mal:** los chips de sede del panel
usaban el color crudo como texto — el chip de Jesús María era amarillo sobre
blanco. Ahora el color va en el punto, el fondo y el borde.

### 🅰️ Parte A — Pantalla del socio

- Encabezado con nombre de sede, "Citas de 20 min", dirección, mini mapa y la
  **zona horaria** (de `ZONA_HORARIA`, en `config.js`)
- Mini calendario: días con cupo resaltados con el color de la sede, días sin
  cupo en gris tachado y no clickeables, día elegido en relleno sólido, hoy con
  un anillo (antes hoy y elegido se pisaban)
- Al elegir un día, la franja **salta a su semana** con ese día marcado también
  en la cabecera de la columna
- Píldoras de horario con borde del color de la sede y texto legible
- **Celular: 3 días a la vez** con las flechas (antes era 1). Verificado que la
  página no scrollea de lado
- La tarjeta del mapa dejó de repetir nombre y dirección: ya estaban justo
  encima. **Esto cierra la decisión que quedó abierta la vez pasada.**

### 🅱️ Parte B — Alta de horarios en lote (`TAREAS.md` 2)

Reemplaza los tres campos sueltos: calendario de varios días + franja horaria con
selectores (hora, minutos de 5 en 5, AM/PM — **nada de teclear la hora**),
intervalo fijo de 20 minutos, y antes de guardar el recuento en vivo
**"Vas a crear 36 horarios en 3 días"** con confirmación.

- No se pueden elegir fechas pasadas (el calendario no las habilita)
- Los duplicados se **saltan en silencio** con `ON CONFLICT DO NOTHING` y al
  final informa **"30 creados, 6 ya existían"**. El recuento se mide contra la
  base **antes** de insertar, para no depender de lo que devuelva el driver
- El trabajador solo puede crear en su sede (RLS lo respalda)

⚠️ **NO cambiar ese `upsert` con `ignoreDuplicates: true` por un upsert normal.**
Pisaría la fila existente y podría volver a marcar como disponible un horario ya
reservado o deshabilitado a mano: así se genera una doble reserva.

### 🅲 Parte C — Borrado en lote (`TAREAS.md` 4)

Casillas por fila, "seleccionar todos los visibles" (respeta el filtro de sede),
botón con el número y confirmación. **Solo admin**, porque RLS solo deja borrar
al admin.

⚠️ **El detalle importante:** `citas.horario_id` es una FK **sin `ON DELETE`**, así
que Postgres rechaza borrar un horario que tenga una cita apuntándolo. Y hay un
caso traicionero: **una cita cancelada libera el horario** (vuelve a verse
"Libre") **pero sigue bloqueando el borrado**. Por eso esas casillas van
deshabilitadas y la fila dice por qué, en vez de dejar que el borrado falle.

### Archivos tocados

`src/js/calendario.js` (nuevo) · `src/js/utils.js` · `src/js/client.js` ·
`src/js/panel.js` · `src/js/sedes.js` · `src/index.html` · `src/css/styles.css` ·
`build.py` (registra el módulo nuevo)
→ `python build.py` regeneró el `index.html` de la raíz (768 KB).

---

## 4. Cómo se verificó — y qué NO se pudo probar

**Probado en un navegador real (Chromium) contra la base de producción:**

- Flujo completo del socio: elegir sede → día → horario → formulario de reserva,
  con la fecha y la sede correctas. **No se reservó ninguna cita.**
- Cambiar de sede repinta el calendario con el otro color y la otra
  disponibilidad
- El texto de las píldoras y de los días sale `#8e6d05`, no el amarillo crudo
- Navegación de meses, y que no se pueda retroceder antes del mes actual
- Alta en lote: 42 celdas, 16 días pasados bloqueados, clic que marca y
  desmarca, arrastre que marca **y** que borra según dónde arranque, soltar
  fuera del calendario sin que quede "pegado"
- Los textos del recuento: "Vas a crear 18 horarios en 3 días — de 5:00pm a
  7:00pm", "La hora de fin tiene que ser posterior a la de inicio", "La franja es
  más corta que una cita de 20 minutos"
- Celular (390 px): 3 columnas y **sin scroll horizontal de la página**
- La lista de horarios sigue cargando (88 filas) y **sin sesión no aparecen ni
  casillas ni barra de borrado**
- `serieDeHoras()` probada aparte con casos borde (franja invertida, igual, que
  no cierra en múltiplo de 20)
- `python build.py` sin colisiones y el bundle combinado pasa `node --check`

🚨 **Lo que NO se pudo probar, y hay que probar:** todo lo que exige **sesión de
admin**. No hay credenciales a mano y crear un usuario habría tocado la base.
Queda verificado por código y por DOM, pero **sin una pasada real**:

1. **Crear horarios de verdad** (el `INSERT` con RLS de admin y de trabajador)
2. **El recuento "X creados, Y ya existían"** contra datos reales
3. **Las casillas de borrado**: que aparezcan, que las bloqueadas se vean
   bloqueadas y que el borrado funcione
4. Que el trabajador **no vea** casillas ni botón de eliminar

---

## 5. Qué toca AHORA

1. **`git push`** — hay un commit local sin subir.
2. **Probar el panel con la cuenta de Luis** (admin): crear una tanda chica de
   horarios en una fecha lejana, ver el recuento, y borrarla con las casillas.
   Ojo a los 4 puntos de arriba.
3. **Probar con un trabajador** — sigue pendiente de la tanda anterior: que vea
   la cita delegada de la OTRA sede, y que en Horarios solo vea los de la suya.
   Eso cierra el punto 9 de `TAREAS.md`.
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
    punto.
12. **El alta en lote usa `ignoreDuplicates: true`.** Un upsert normal pisaría
    horarios existentes y puede provocar doble reserva.

---

## 7. Decisiones que dependen de Christopher

Ninguna abierta.

La que había —el nombre y la dirección repetidos en la pantalla de horarios— se
resolvió en esta tanda: se quitaron de la tarjeta del mapa y quedaron solo en el
encabezado, que es donde los pedía la Parte A.

Dos cosas que decidí solo, por si no coinciden con lo que esperabas:

- **Celular: 3 días a la vez** con flechas, en vez de scroll horizontal en la
  franja. Las dos opciones estaban permitidas; con 3 columnas no hay ningún
  scroll lateral y se sigue viendo el día completo.
- **Los minutos van de 5 en 5** en los selectores de hora (no solo 00/20/40).
  Es para no bloquear casos como los horarios de 8:10 que ya existen en la base.
