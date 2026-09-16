-- ============================================================
-- BIOFIT — Esquema de base de datos (Supabase)
-- ============================================================
-- ⚠️⚠️  DOCUMENTACIÓN DESACTUALIZADA. NO EJECUTAR. NO USAR COMO FUENTE DE VERDAD.
--
-- La base real (proyecto snuefzvfhucgfllnifat) tiene cambios que este archivo
-- NO refleja. Entre otros: las columnas `sedes.mapa_embed` y `sedes.maps_url`,
-- las direcciones reales, las tildes de "Jesús María", y los triggers de correo
-- (trg_notificar_cita_nueva, trg_notificar_cita_delegada).
--
-- El contrato vigente de la base está en CLAUDE.md. Si hace falta el esquema
-- exacto, consultarlo contra la base, no contra este archivo.
--
-- Última actualización: 15/09/2026 (parcial)
-- ============================================================


-- ============================================================
-- 1. TABLAS
-- ============================================================

-- ---- Sedes (fijas, 2 registros) ----
create table sedes (
  id        text primary key,          -- 'magdalena' | 'jesus_maria'
  nombre    text not null,
  direccion text,
  color     text                        -- color distintivo en el panel
);

insert into sedes (id, nombre, direccion, color) values
  ('magdalena',   'Sede Magdalena del Mar', 'XFLY Magdalena del Mar', '#16a34a'),
  ('jesus_maria', 'Sede Jesus Maria',       'XFLY Jesus Maria',       '#eab308');


-- ---- Perfiles: quién tiene credenciales y con qué rol ----
-- El cliente/socio NO aparece aquí: reserva de forma anónima, sin cuenta.
create table perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text,
  rol        text not null default 'trabajador'
             check (rol in ('admin', 'trabajador')),
  sede_id    text references sedes(id),   -- sede asignada (null = todas, para admin)
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table perfiles is
  'Perfil y rol de cada usuario con credenciales. admin = control total; trabajador = permisos reducidos.';

create index idx_perfiles_rol  on perfiles (rol);
create index idx_perfiles_sede on perfiles (sede_id);


-- ---- Horarios que el equipo habilita ----
create table horarios_disponibles (
  id         uuid primary key default gen_random_uuid(),
  sede_id    text not null references sedes(id),
  fecha      date not null,
  hora       time not null,
  disponible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sede_id, fecha, hora)
);

create index idx_horarios_sede_fecha on horarios_disponibles (sede_id, fecha);


-- ---- Citas reservadas por los socios ----
create table citas (
  id               uuid primary key default gen_random_uuid(),
  horario_id       uuid not null references horarios_disponibles(id),
  sede_id          text not null references sedes(id),
  nombre_cliente   text not null,
  telefono_cliente text not null,
  email_cliente    text,
  fecha            date not null,
  hora             time not null,
  estado           text not null default 'confirmada',  -- 'confirmada' | 'cancelada'
  asignado_a       uuid references perfiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on column citas.asignado_a is
  'Trabajador al que el admin delegó esta cita. NULL = sin asignar (solo la ve el admin).';

create index idx_citas_sede_fecha on citas (sede_id, fecha);
create index idx_citas_asignado   on citas (asignado_a);


-- ---- Correos que reciben el aviso interno, configurables por sede ----
create table notificaciones_sede (
  id         uuid primary key default gen_random_uuid(),
  sede_id    text not null references sedes(id) on delete cascade,
  email      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sede_id, email)
);

comment on table notificaciones_sede is
  'Correos que reciben el aviso cuando entra una cita nueva, configurables por sede desde el panel.';

create index idx_notif_sede on notificaciones_sede (sede_id) where activo;


-- ============================================================
-- 2. FUNCIONES HELPER
-- ============================================================
-- SECURITY DEFINER es indispensable: sin él, consultar `perfiles` dentro de una
-- política RLS de `perfiles` provocaría recursión infinita.
-- El search_path fijo evita el secuestro de search_path.

create or replace function mi_rol()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select rol from perfiles where id = auth.uid() and activo = true;
$$;

create or replace function es_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and rol = 'admin' and activo = true
  );
$$;

create or replace function es_trabajador()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and rol = 'trabajador' and activo = true
  );
$$;

create or replace function mi_sede()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select sede_id from perfiles where id = auth.uid() and activo = true;
$$;

-- Solo las usa el frontend autenticado y las políticas RLS.
revoke all on function mi_rol(), es_admin(), es_trabajador(), mi_sede() from anon, public;
grant execute on function mi_rol(), es_admin(), es_trabajador(), mi_sede() to authenticated;


-- ============================================================
-- 3. TRIGGERS — integridad de la agenda
-- ============================================================

-- Al reservar, marcar el horario como ocupado dentro de la misma transacción.
-- Si otro ya lo tomó, la inserción falla: así se evita el doble-booking.
create or replace function marcar_horario_ocupado()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update horarios_disponibles
  set disponible = false
  where id = new.horario_id
    and disponible = true;

  if not found then
    raise exception 'Este horario ya no está disponible';
  end if;

  return new;
end;
$$;

create trigger trg_marcar_horario_ocupado
before insert on citas
for each row execute function marcar_horario_ocupado();


-- Al cancelar una cita, liberar el horario para que otro socio pueda tomarlo.
create or replace function liberar_horario_si_cancela()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    update horarios_disponibles
    set disponible = true
    where id = new.horario_id;
  end if;
  return new;
end;
$$;

create trigger trg_liberar_horario
after update on citas
for each row execute function liberar_horario_si_cancela();

-- Son funciones de trigger: no deben poder invocarse por la API REST.
revoke all on function marcar_horario_ocupado()      from anon, authenticated, public;
revoke all on function liberar_horario_si_cancela()  from anon, authenticated, public;


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table sedes                enable row level security;
alter table perfiles             enable row level security;
alter table horarios_disponibles enable row level security;
alter table citas                enable row level security;
alter table notificaciones_sede  enable row level security;


-- ---- SEDES ----
-- Lectura pública: el socio necesita ver las sedes (y sus colores) sin sesión.
create policy "sedes: lectura publica"
  on sedes for select
  using (true);

create policy "sedes: solo admin actualiza"
  on sedes for update to authenticated
  using (es_admin()) with check (es_admin());


-- ---- PERFILES ----
create policy "perfiles: ver propio o admin ve todos"
  on perfiles for select to authenticated
  using (id = auth.uid() or es_admin());

create policy "perfiles: solo admin inserta"
  on perfiles for insert to authenticated
  with check (es_admin());

create policy "perfiles: solo admin actualiza"
  on perfiles for update to authenticated
  using (es_admin()) with check (es_admin());

create policy "perfiles: solo admin elimina"
  on perfiles for delete to authenticated
  using (es_admin());


-- ---- HORARIOS DISPONIBLES ----
-- Lectura pública: el socio necesita ver qué horarios quedan libres.
create policy "horarios: lectura publica"
  on horarios_disponibles for select
  using (true);

create policy "horarios: admin todas, trabajador su sede"
  on horarios_disponibles for insert to authenticated
  with check (es_admin() or (es_trabajador() and sede_id = mi_sede()));

create policy "horarios: update admin todas, trabajador su sede"
  on horarios_disponibles for update to authenticated
  using      (es_admin() or (es_trabajador() and sede_id = mi_sede()))
  with check (es_admin() or (es_trabajador() and sede_id = mi_sede()));

create policy "horarios: solo admin elimina"
  on horarios_disponibles for delete to authenticated
  using (es_admin());


-- ---- CITAS ----
-- El socio puede CREAR una cita sin sesión, pero NO puede leer ninguna:
-- así los datos de contacto de unos clientes no quedan expuestos a otros.
create policy "citas: reserva publica"
  on citas for insert to anon, authenticated
  with check (true);

create policy "citas: admin ve todas, trabajador solo las suyas"
  on citas for select to authenticated
  using (es_admin() or (es_trabajador() and asignado_a = auth.uid()));

create policy "citas: admin edita todas, trabajador solo las suyas"
  on citas for update to authenticated
  using      (es_admin() or (es_trabajador() and asignado_a = auth.uid()))
  with check (es_admin() or (es_trabajador() and asignado_a = auth.uid()));

create policy "citas: solo admin elimina"
  on citas for delete to authenticated
  using (es_admin());


-- ---- NOTIFICACIONES POR SEDE ----
-- Solo el admin. La Edge Function las lee con service_role, que ignora RLS.
create policy "notificaciones: solo admin ve"
  on notificaciones_sede for select to authenticated
  using (es_admin());

create policy "notificaciones: solo admin inserta"
  on notificaciones_sede for insert to authenticated
  with check (es_admin());

create policy "notificaciones: solo admin actualiza"
  on notificaciones_sede for update to authenticated
  using (es_admin()) with check (es_admin());

create policy "notificaciones: solo admin elimina"
  on notificaciones_sede for delete to authenticated
  using (es_admin());


-- ============================================================
-- 5. REALTIME
-- ============================================================
-- Permite que el panel se actualice solo cuando entra una cita nueva.
alter publication supabase_realtime add table citas;


-- ============================================================
-- 6. DATOS INICIALES
-- ============================================================

-- Perfil de administrador para Luis (su usuario ya existe en Auth).
insert into perfiles (id, email, nombre, rol, sede_id, activo)
select id, email, 'Luis Villayzán', 'admin', null, true
from auth.users
where email = 'biofit.consulting1@gmail.com'
on conflict (id) do update set rol = 'admin', activo = true;

-- Correos que reciben los avisos (editables después desde el panel).
insert into notificaciones_sede (sede_id, email) values
  ('magdalena',   'biofit.consulting1@gmail.com'),
  ('jesus_maria', 'biofit.consulting1@gmail.com')
on conflict (sede_id, email) do nothing;
