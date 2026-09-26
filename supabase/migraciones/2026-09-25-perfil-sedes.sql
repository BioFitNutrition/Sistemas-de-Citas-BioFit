-- ============================================================
-- BioFit — El trabajador pasa a gestionar UN CONJUNTO de sedes
-- Fecha: 25/09/2026
-- ✅ APLICADA en produccion el 25/09/2026 por Claude Code
--    (migracion `perfil_sedes_seleccion_multiple`), con el visto bueno de
--    Christopher. Es el punto 8 de TAREAS.md.
-- ============================================================
--
-- POR QUE
-- `perfiles.sede_id` es UNA columna: solo puede decir "esta sede" o NULL, que
-- por convencion significaba "todas". Con 2 sedes alcanzaba. Con 3 (Lince abrio
-- el 25/09/2026) se cae: "Magdalena y Jesus Maria pero NO Lince" no se puede ni
-- escribir.
--
-- QUE HACE
--   1. Crea `perfil_sedes` (una fila por sede que gestiona), con sus politicas
--   2. Migra lo que habia: sede concreta -> 1 fila; NULL ("todas") -> una por sede
--   3. Crea `mis_sedes()`, que reemplaza a `mi_sede()`
--   4. Reescribe las 4 politicas que dependian de `mi_sede()`:
--        citas    SELECT y UPDATE
--        horarios INSERT y UPDATE
--
-- DECISION DE DISEÑO: el conjunto es EXPLICITO. No queda ningun "todas" que se
-- estire solo. Si BioFit abre una sede nueva, nadie la gestiona hasta que el
-- admin la marque. Lo eligio Christopher: es mas predecible, y nadie gana acceso
-- a las citas de un local sin que alguien lo decida.
--
-- `perfiles.sede_id` queda EN DESUSO. No se borra: es lo unico que permite
-- revertir. Ni el frontend ni las politicas la leen.
--
-- ⚠️ El SELECT de `horarios_disponibles` es publico (el socio ve los cupos), asi
-- que RLS NO acota la lectura del trabajador ahi. Recortarla a sus sedes lo hace
-- el frontend, en `cargarHorarios()` de panel.js. No es cosmetico.
-- ============================================================


-- ---------- 1. Tabla ----------
create table if not exists perfil_sedes (
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  sede_id    text not null references sedes(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (perfil_id, sede_id)
);

create index if not exists idx_perfil_sedes_perfil on perfil_sedes (perfil_id);

alter table perfil_sedes enable row level security;

create policy "perfil_sedes: ve las suyas, admin ve todas"
  on perfil_sedes for select to authenticated
  using (perfil_id = auth.uid() or es_admin());
create policy "perfil_sedes: solo admin asigna"
  on perfil_sedes for insert to authenticated
  with check (es_admin());
create policy "perfil_sedes: solo admin quita"
  on perfil_sedes for delete to authenticated
  using (es_admin());


-- ---------- 2. Traer lo que ya habia ----------
insert into perfil_sedes (perfil_id, sede_id)
select p.id, s.id
  from perfiles p cross join sedes s
 where p.rol = 'trabajador' and p.sede_id is null
union
select p.id, p.sede_id
  from perfiles p
 where p.rol = 'trabajador' and p.sede_id is not null
on conflict do nothing;


-- ---------- 3. Helper ----------
create or replace function mis_sedes()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ps.sede_id
    from perfil_sedes ps
    join perfiles p on p.id = ps.perfil_id
   where ps.perfil_id = auth.uid()
     and p.activo
$$;

revoke all on function mis_sedes() from public;
grant execute on function mis_sedes() to authenticated;


-- ---------- 4. Politicas ----------
drop policy if exists "citas: admin todas, trabajador su sede o ambas (ver)"    on citas;
drop policy if exists "citas: admin todas, trabajador su sede o ambas (editar)" on citas;

create policy "citas: admin todas, trabajador las de sus sedes (ver)"
  on citas for select to authenticated
  using (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())));

create policy "citas: admin todas, trabajador las de sus sedes (editar)"
  on citas for update to authenticated
  using      (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())))
  with check (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())));

drop policy if exists "horarios: admin todas, trabajador su sede o ambas"        on horarios_disponibles;
drop policy if exists "horarios: update admin todas, trabajador su sede o ambas" on horarios_disponibles;

create policy "horarios: admin todas, trabajador los de sus sedes (crear)"
  on horarios_disponibles for insert to authenticated
  with check (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())));

create policy "horarios: admin todas, trabajador los de sus sedes (editar)"
  on horarios_disponibles for update to authenticated
  using      (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())))
  with check (es_admin() or (es_trabajador() and sede_id in (select mis_sedes())));

comment on column perfiles.sede_id is
  'EN DESUSO desde el 25/09/2026: reemplazada por la tabla perfil_sedes. Se conserva para poder revertir; ni el frontend ni las politicas RLS la leen.';


-- ============================================================
-- COMO SE VERIFICO (suplantando roles contra la base real)
-- ============================================================
-- Annie con solo jesus_maria     -> 25 citas, 0 de otra sede
-- Annie con jesus_maria+magdalena-> 31 citas (25 + 6), 0 de lince
-- Annie con solo magdalena       ->  6 citas, 0 de jesus_maria
-- Annie (solo jesus_maria) insertando un horario en magdalena:
--   ERROR 42501 new row violates row-level security policy   <- correcto
-- Annie (solo jesus_maria) insertando un horario en jesus_maria: paso  <- correcto


-- ============================================================
-- PARA REVERTIR
-- ============================================================
-- ⚠️ Hay que rearmar `perfiles.sede_id` ANTES de tirar la tabla. Los
-- trabajadores creados despues de esta migracion tienen sede_id NULL, y NULL en
-- el modelo viejo significa "TODAS LAS SEDES": si se revierte sin este paso, a
-- todos ellos se les abre el acceso a todo.
--
--   -- 1. reconstruir la columna vieja desde perfil_sedes
--   update perfiles p set sede_id = sub.unica
--     from (select perfil_id,
--                  case when count(*) = (select count(*) from sedes)
--                       then null                      -- gestiona todas
--                       else min(sede_id) end as unica -- se pierde el resto
--             from perfil_sedes group by perfil_id) sub
--    where p.id = sub.perfil_id;
--
--   -- ⚠️ Un trabajador con 2 de 3 sedes NO se puede representar: se queda con
--   --    una sola. Esa perdida es inevitable, y es justo el motivo de existir
--   --    de perfil_sedes.
--
--   -- 2. politicas viejas
--   drop policy if exists "citas: admin todas, trabajador las de sus sedes (ver)"    on citas;
--   drop policy if exists "citas: admin todas, trabajador las de sus sedes (editar)" on citas;
--   create policy "citas: admin todas, trabajador su sede o ambas (ver)"
--     on citas for select to authenticated
--     using (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())));
--   create policy "citas: admin todas, trabajador su sede o ambas (editar)"
--     on citas for update to authenticated
--     using      (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())))
--     with check (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())));
--
--   drop policy if exists "horarios: admin todas, trabajador los de sus sedes (crear)"  on horarios_disponibles;
--   drop policy if exists "horarios: admin todas, trabajador los de sus sedes (editar)" on horarios_disponibles;
--   create policy "horarios: admin todas, trabajador su sede o ambas"
--     on horarios_disponibles for insert to authenticated
--     with check (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())));
--   create policy "horarios: update admin todas, trabajador su sede o ambas"
--     on horarios_disponibles for update to authenticated
--     using      (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())))
--     with check (es_admin() or (es_trabajador() and (mi_sede() is null or sede_id = mi_sede())));
--
--   -- 3. recien ahora
--   drop function if exists mis_sedes();
--   drop table if exists perfil_sedes;
-- ============================================================
