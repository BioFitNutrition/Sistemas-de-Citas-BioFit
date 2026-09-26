-- ============================================================
-- BioFit — El trabajador ve las citas de SU SEDE
-- Fecha: 25/09/2026
-- ✅ APLICADA en produccion el 25/09/2026 por Claude Code (migracion
--    `citas_visibles_por_sede`). Verificada suplantando roles: admin 31 citas,
--    trabajador de jesus_maria 25 y ninguna de la otra sede, trabajador
--    inactivo 0, anon 0. `supabase/schema.sql` ya refleja el estado nuevo.
-- ============================================================
--
-- POR QUÉ
-- Se eliminó la delegación de citas (el admin ya no asigna cita por cita).
-- Con la política actual, el trabajador solo ve las citas cuyo `asignado_a`
-- es él, así que al dejar de asignarse su lista quedaría vacía para siempre.
--
-- El modelo nuevo es: el trabajador PERTENECE a una sede (o a ambas, que en la
-- base es `perfiles.sede_id = NULL`) y ve las citas de esa sede.
--
-- QUÉ HACE
-- Reemplaza las políticas de SELECT y UPDATE de `citas` para el rol
-- `authenticated`. No toca:
--   · la política de INSERT del rol anónimo (el socio reservando)
--   · la de DELETE (sigue siendo solo del admin)
--   · la columna `citas.asignado_a`, que se queda como historial
--
-- CÓMO CORRERLO
-- Dashboard de Supabase → SQL Editor → pegar todo → Run.
--
-- ⚠️ Es reversible: al final está el SQL para volver atrás.
-- ============================================================


-- ---------- 0. Ver qué hay ahora (informativo, no cambia nada) ----------
-- Conviene copiar este resultado antes de seguir, por si hay que revertir.

select
  polname                                as politica,
  case pol.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as comando,
  pol.polroles::regrole[]                as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relname = 'citas'
order by comando, politica;


-- ---------- 1. Quitar las políticas de lectura y edición actuales ----------
-- Se borran por descubrimiento y no por nombre, porque el nombre exacto puede
-- variar. Solo se tocan SELECT ('r') y UPDATE ('w') del rol `authenticated`.

do $$
declare
  p record;
begin
  for p in
    select pol.polname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relname = 'citas'
      and pol.polcmd in ('r', 'w')
      and 'authenticated'::regrole = any (pol.polroles)
  loop
    raise notice 'Quitando política: %', p.polname;
    execute format('drop policy %I on public.citas', p.polname);
  end loop;
end $$;


-- ---------- 2. Crear las nuevas ----------
-- Misma forma que ya usan las políticas de `horarios_disponibles`:
--   admin  -> todo
--   trabajador -> su sede, o todas si su `sede_id` es NULL ("ambas sedes")
-- `mi_sede()` y `es_admin()` ya existen y son STABLE SECURITY DEFINER.

create policy "citas: admin todas, trabajador su sede o ambas (ver)"
  on public.citas
  for select
  to authenticated
  using (
    es_admin()
    or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede()))
  );

create policy "citas: admin todas, trabajador su sede o ambas (editar)"
  on public.citas
  for update
  to authenticated
  using (
    es_admin()
    or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede()))
  )
  with check (
    es_admin()
    or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede()))
  );


-- ---------- 3. Comprobar cómo quedó ----------

select
  polname                                as politica,
  case pol.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as comando,
  pol.polroles::regrole[]                as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relname = 'citas'
order by comando, politica;


-- ============================================================
-- PARA REVERTIR
-- ============================================================
-- Si hay que volver al modelo de "solo las citas asignadas a él", correr:
--
--   drop policy if exists "citas: admin todas, trabajador su sede o ambas (ver)"    on public.citas;
--   drop policy if exists "citas: admin todas, trabajador su sede o ambas (editar)" on public.citas;
--
--   create policy "citas: admin todas, trabajador las suyas (ver)"
--     on public.citas for select to authenticated
--     using (es_admin() or (es_trabajador() and asignado_a = auth.uid()));
--
--   create policy "citas: admin todas, trabajador las suyas (editar)"
--     on public.citas for update to authenticated
--     using (es_admin() or (es_trabajador() and asignado_a = auth.uid()))
--     with check (es_admin() or (es_trabajador() and asignado_a = auth.uid()));
--
-- (Comprobar contra el resultado del paso 0, que es el estado real de antes.)
-- ============================================================
