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
| **Siguiente** | Christopher — **probar con la cuenta de Luis y con un trabajador real** (todo lo demás está aplicado y subido) |

## ✅ No queda nada bloqueando

La migración **ya se corrió**, el `schema.sql` está al día, el trabajo del
frontend está **commiteado y subido**. No hay nada pendiente de correr a mano ni
de subir.

---

## 2. Cambios en la base

**Migración aplicada:** `citas_visibles_por_sede` — 25/09/2026, por Claude Code,
con el visto bueno de Christopher.

Archivo: `supabase/migraciones/2026-09-25-citas-por-sede.sql` (queda sellado como
APLICADA, con el SQL de reversa al final).

Qué hizo: cambió las políticas RLS de **SELECT y UPDATE de `citas`** para el rol
`authenticated`. El trabajador ya no ve "las citas que le asignaron" sino **las
de su sede**:

```sql
-- se quitaron (modelo viejo, basado en la delegación ya eliminada)
using (es_admin() or (es_trabajador() and asignado_a = auth.uid()))

-- quedaron
create policy "citas: admin todas, trabajador su sede o ambas (ver)"
  on public.citas for select to authenticated
  using (es_admin() or (es_trabajador()
         and (mi_sede() is null or sede_id = mi_sede())));

create policy "citas: admin todas, trabajador su sede o ambas (editar)"
  on public.citas for update to authenticated
  using      (es_admin() or (es_trabajador()
              and (mi_sede() is null or sede_id = mi_sede())))
  with check (es_admin() or (es_trabajador()
              and (mi_sede() is null or sede_id = mi_sede())));
```

**No se tocó** el INSERT del socio anónimo, ni el DELETE (sigue siendo solo del
admin), ni ninguna columna. `citas.asignado_a` sigue ahí como historial.

**Verificado contra la base real, suplantando cada rol:**

| Quién | Citas que ve | De la otra sede |
|---|---|---|
| Admin (`sede_id` NULL) | **31** (todas) | — |
| Trabajador de Jesús María, activo | **25** | **0** |
| Trabajador **desactivado** | **0** | — |
| `anon` (el socio) | **0** | — |

Esto era lo que la simulación no podía cubrir. Ya está cubierto.

⚠️ Pero sigue **sin probarse desde el navegador con sesión real** — la política
está bien, lo que falta es confirmar que el panel la aprovecha bien. Ver punto 4.

---

## 3. Dónde estamos

El sistema **está en producción y funcionando**. No es un prototipo.

- Base de datos completa y verificada en Supabase (`snuefzvfhucgfllnifat`),
  Postgres 17, `ACTIVE_HEALTHY`
- 5 tablas con RLS activo: `sedes` (2) · `horarios_disponibles` (319) ·
  `citas` (31) · `perfiles` (4) · `notificaciones_sede` (3)
- Frontend modular publicado en GitHub Pages, **al día con `main`**
- Las dos Edge Functions **desplegadas y activas** (`notify-cita`, `crear-usuario`)
- **Los correos funcionan y están probados en producción**
- 3 roles: socio (anónimo), trabajador, admin. RLS los separa de verdad

---

## 4. Qué toca AHORA — todo es prueba manual

Nada de esto lo puedo hacer yo: hace falta abrir la web y entrar con las cuentas.

1. **Con la cuenta de Luis (admin):** crear un trabajador de prueba con una sede,
   ver que aparece en Correos; cambiarle la sede y ver cómo se mueve el correo;
   desactivarlo y ver que desaparece.
2. **Con ese trabajador:** que vea las citas de su sede y ninguna de la otra, y
   que no le salga ningún botón de borrar.
3. **Crear y borrar horarios de verdad** con sesión de admin (viene pendiente de
   dos tandas atrás; el código ya se probó en navegador, pero no contra la base).

Después de eso, lo siguiente por valor:

4. Punto **10** de `TAREAS.md` — un clic en el dashboard (protección de
   contraseñas filtradas). Es lo más rápido que hay.
5. Punto **11** — "¿Olvidaste tu contraseña?".
6. Punto **17** — recordatorios con `pg_cron`. Va **antes** que el 16 (Google
   Calendar): resuelve el mismo pedido sin depender de Google.

---

## 5. Qué cambió en el código la última vez

La tanda del frontend (delegación eliminada, correos por sede, citas en dos
secciones, botón "Soy nuevo") **ya está commiteada y subida**. El detalle vive en
`TAREAS.md`, puntos 6 y 9, y en el mensaje del commit.

Archivos tocados en esta última pasada: `supabase/schema.sql` (políticas nuevas
de `citas` + notas sobre `asignado_a` en desuso), `TAREAS.md`,
`supabase/migraciones/2026-09-25-citas-por-sede.sql` (sellado como aplicada) y
este `ESTADO.md`. `python build.py` corrió sin colisiones → `index.html` (790 KB).

---

## 6. Reglas que no se rompen

1. **`service_role` NUNCA en el frontend.** La `anon key` sí va.
2. **No tocar el patrón de `notify-cita`**: 200 inmediato + `EdgeRuntime.waitUntil`.
3. **Los mapas NO llevan API key de Google.** `output=embed` + Maps URLs.
4. **Fechas con `isoLocal()`**, nunca `toISOString().slice(0,10)`.
5. **"Ocupado" se deriva de `horarios_disponibles.disponible`**, nunca de cruzar
   con `citas`.
6. **Sedes: todo sale de la base.**
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
13. **Los correos de los trabajadores los manda la pestaña Usuarios.** Editarlos
    a mano en Correos funciona, pero el próximo cambio de sede los reacomoda.
14. **La sincronización de correos toca solo las filas de ese email.** Nunca
    barrer `notificaciones_sede` entera.

---

## 7. Decisiones que dependen de Christopher

**1. El punto 13 de `TAREAS.md` quedó sin piso.** Eran dos correos de
delegación; al no haber delegación, el (a) —avisar al trabajador anterior en una
reasignación— ya no existe. El (b) —avisar de una cancelación— sigue teniendo
sentido, pero el destinatario natural son los correos de la sede, que ya incluyen
a sus trabajadores: **se funde con el punto 7**. Hay que confirmar cómo lo quieres
antes de tocarlo.

**2. ¿Hace falta ver los horarios eliminados?** Hoy no se puede: al borrarlos
desaparece la fila. Mostrarlos implicaría archivar en vez de borrar, y eso toca
la base.

**3. `citas.asignado_a` se quedó en la base** como historial. No molesta. Si
algún día se quiere limpiar, hay que quitar antes el trigger
`trg_notificar_cita_delegada` (hoy inofensivo: ya nada escribe esa columna, así
que nunca se dispara).
