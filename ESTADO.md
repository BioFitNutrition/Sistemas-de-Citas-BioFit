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
| **Siguiente** | Christopher — revisar en producción; luego sigue la tanda de interfaz |

---

## 2. Dónde estamos

El sistema **está en producción y funcionando**. No es un prototipo.

- Base de datos completa y verificada en Supabase (`snuefzvfhucgfllnifat`)
- Frontend modular publicado en GitHub Pages
- Las dos Edge Functions **desplegadas y activas** (`notify-cita`, `crear-usuario`)
- **Los correos funcionan y están probados en producción**: aviso interno,
  confirmación al socio, aviso al trabajador cuando se le delega una cita
- 3 roles funcionando: socio (anónimo), trabajador, admin. RLS en la base los
  separa de verdad, no solo ocultando botones

✅ **Ya no hay bugs conocidos en producción.** El único que había —al trabajador
no le aparecía la cita delegada de la otra sede— está arreglado en este cambio.

---

## 3. Qué cambió la última vez

**Claude Code tocó SOLO el frontend (`/src`). La base de datos no se tocó.**
Se hicieron tres pendientes de `TAREAS.md`: **1**, **12** y **5 (a, b, c, d)**.

### 🔴 Punto 1 — Bug del trabajador: ARREGLADO

En `src/js/panel.js`:

- La pestaña **Citas** ya no filtra por sede cuando el usuario es trabajador. El
  selector de sede se le oculta (`#tab-citas .filter-row__sede`) y, por si acaso,
  `cargarCitas()` ignora el filtro a propósito para ese rol.
- La pestaña **Horarios** conserva el filtro por sede, como estaba: ahí sí tiene
  sentido, y quien tiene sede fija sigue amarrado a ella.
- El **chip de sede** ya se pintaba en cada cita, así que el trabajador ve a qué
  sede corresponde cada una.

El modelo no cambió: `perfiles.sede_id` sigue controlando **solo** qué horarios
gestiona, no de qué sede puede recibir citas.

Derivado del mismo punto, en la pestaña **Usuarios**: la etiqueta "Sede" pasó a
**"Sede que gestiona"** y se agregó una nota aclarando que el trabajador igual
puede recibir citas de cualquier sede.

### 🗺️ Punto 12 — Mini mapa de la sede: HECHO

- `src/js/sedes.js` ahora lee también `mapa_embed` y `maps_url`, y los expone con
  `mapaEmbedSede()` / `mapsUrlSede()`, igual que `color` y `direccion`.
- Al elegir sede, encima del calendario aparece una tarjeta con: **nombre**,
  **dirección de calle**, **mini mapa** en iframe (`loading="lazy"`, bordes
  redondeados) y botón **"Cómo llegar"**.
- **Nada de esto está escrito en el código**: todo sale de la tabla `sedes`.
- Si una sede no tuviera `mapa_embed`, el iframe simplemente no se muestra y el
  botón "Cómo llegar" sigue ahí. Al cambiar de sede el `src` se limpia antes de
  pintar el nuevo, para que no quede a la vista el mapa de la sede anterior.

### 💅 Punto 5 — Interfaz: HECHO (a, b, c y d)

- **a)** El botón de arriba a la derecha dice **"Team Enterprise"**.
- **b)** Ese botón **desaparece dentro del panel** (`showView()` lo oculta en
  `view-panel`). Ahí arriba solo queda "Cerrar sesión".
- **c)** "Team Enterprise" y "Cerrar sesión" dejaron de ser links planos: ahora
  son botones tipo píldora con ícono, en la paleta BioFit. El de la topbar es un
  contorno crema que se llena de teal al pasar el mouse; el de cerrar sesión es
  un contorno neutro que se vuelve rojo.
- **d)** **Ojito** en los dos campos de contraseña (login y alta de trabajador).
  El helper es `initTogglesPassword()` en `utils.js` y funciona con cualquier
  campo que lleve `[data-pwd-toggle]` — el punto 11 lo va a reutilizar tal cual.

### Archivos tocados

`src/index.html` · `src/css/styles.css` · `src/js/panel.js` · `src/js/sedes.js` ·
`src/js/client.js` · `src/js/utils.js` · `src/js/main.js`
→ `python build.py` regeneró el `index.html` de la raíz (738 KB).

### Cómo se verificó

- `python build.py` pasa sin colisiones de nombres.
- El bundle combinado se chequeó con `node --check`: sintaxis OK.
- Se abrió la web ya construida en un navegador real (Chromium headless) contra
  la **base de datos de producción**: cargan las 2 sedes, el mapa se pinta con la
  dirección y las coordenadas reales de cada sede, "Cómo llegar" apunta bien, el
  ojito alterna, no hay errores en consola y en celular (390 px) no hay scroll
  horizontal. Se probó también cambiar de una sede a la otra.
- ⚠️ **Lo que NO se pudo probar con sesión iniciada:** el panel del trabajador.
  No hay credenciales de trabajador a mano y crear una cuenta habría tocado la
  base. La corrección del punto 1 está revisada en código y los selectores se
  verificaron contra el DOM real, pero **falta la prueba con un trabajador de
  verdad** (es justo el punto 9 de `TAREAS.md`).

---

## 4. Qué toca AHORA

### 🧪 Primero — Probar el arreglo del punto 1 con un trabajador real

Es lo único pendiente del trabajo de hoy. Entrar con uno de los dos trabajadores
de prueba y confirmar que **ve la cita delegada de la OTRA sede**, con su chip de
sede, y que en Horarios sigue viendo solo los de la suya. Eso cierra además buena
parte del punto 9 de `TAREAS.md`.

### 🎨 Después — Lo que queda de la tanda de interfaz

- **Punto 2** — Calendario visual para agregar horarios, con selección de varios
  días y selector AM/PM
- **Punto 4** — Eliminar horarios en lote con casillas — **solo admin**, RLS no
  deja borrar al trabajador
- **Punto 3** — Revisar a fondo la generación de horarios

### ✨ Luego

- **Punto 6** — Botón "Soy nuevo" (el mini mapa del punto 12 ya está listo para
  reutilizarse ahí, que es donde más importa)
- **Punto 11** — "¿Olvidaste tu contraseña?" — el ojito del punto 5d ya está
  hecho y se reutiliza
- **Punto 10** — Activar la protección de contraseñas filtradas (un clic en el
  dashboard de Supabase)

### 🗄️ Cuando se toque la base — `cancelada_por` (puntos 7 y 13)

Única migración aprobada que falta. **Avisar antes de correrla.** Los dos correos
nuevos de delegación (punto 13) dependen de ella para el caso b.

---

## 5. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** El repo es público. Lo que necesite
   privilegios va en una Edge Function. La `anon key` sí va, es su uso previsto.
2. **No tocar el patrón de `notify-cita`**: responde 200 de inmediato y manda el
   correo con `EdgeRuntime.waitUntil`. pg_net corta a los 8 s y Gmail tarda ~6 s.
   Si se cambia, los correos dejan de salir. Ya pasó una vez.
3. **Los mapas NO llevan API key de Google.** La Embed API oficial exige tarjeta
   de crédito y el proyecto no puede tener eso. Se usa `output=embed` para el
   iframe y Maps URLs para el botón. **No "mejorarlo" a la API oficial.**
4. **Fechas con `isoLocal()`, nunca `toISOString().slice(0,10)`.** En Perú (GMT−5)
   el segundo devuelve el día equivocado después de las 7 pm.
5. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas` — con RLS el trabajador no ve las citas de otros y creería que el
   horario está libre.
6. **Sedes: todo sale de la base** (nombre, dirección, color, mapa). Si Luis se
   muda de local, se cambia una fila — no se toca código.
7. **No modificar la base de datos** salvo la migración ya aprobada.
8. **Nada de lo que ya funciona puede dejar de funcionar.** Ante la duda entre una
   mejora vistosa y no tocar algo que anda, gana no tocarlo.
9. Flujo de publicación: `editar /src` → `python build.py` → `git add -A` →
   `git commit` → `git push`. El `index.html` de la raíz es **generado**, no se
   edita a mano.
10. **La lista de citas del trabajador no se filtra por sede.** Es el bug que se
    arregló hoy; volver a filtrarla ahí lo reintroduce.

---

## 6. Decisiones que dependen de Christopher

**Una, chica y sin apuro:** en la pantalla de horarios, el nombre y la dirección
de la sede aparecen **dos veces seguidas** — arriba en el encabezado del
calendario (que ya estaba y fue aprobado) y otra vez dentro de la tarjeta nueva
del mapa, porque el punto 12 pedía mostrarlos ahí.

Se dejó tal como lo pedía la tarea. Si a Luis le parece repetitivo, la solución
es quitar esas dos líneas **de la tarjeta del mapa** (no del encabezado) y dejar
ahí solo el mapa y el botón "Cómo llegar". Es un cambio de dos líneas en
`src/index.html`.
