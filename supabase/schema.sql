-- ============================================
-- BIOFIT - Esquema de base de datos (Supabase)
-- ============================================

-- Tabla de sedes (fijas, solo 2 registros)
create table sedes (
  id text primary key,          -- 'magdalena' | 'jesus_maria'
  nombre text not null,
  direccion text
);

insert into sedes (id, nombre, direccion) values
  ('magdalena', 'Sede Magdalena', 'Magdalena del Mar, Perú'),
  ('jesus_maria', 'Sede Jesús María', 'Jesús María, Perú');

-- Horarios que Luis habilita desde el panel de admin
create table horarios_disponibles (
  id uuid primary key default gen_random_uuid(),
  sede_id text not null references sedes(id),
  fecha date not null,
  hora time not null,
  disponible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sede_id, fecha, hora)
);

-- Citas reservadas por clientes
create table citas (
  id uuid primary key default gen_random_uuid(),
  horario_id uuid not null references horarios_disponibles(id),
  sede_id text not null references sedes(id),
  nombre_cliente text not null,
  telefono_cliente text not null,
  email_cliente text,
  fecha date not null,
  hora time not null,
  estado text not null default 'confirmada', -- 'confirmada' | 'cancelada'
  created_at timestamptz not null default now()
);

-- Índices útiles
create index idx_horarios_sede_fecha on horarios_disponibles (sede_id, fecha);
create index idx_citas_sede_fecha on citas (sede_id, fecha);

-- ============================================
-- Row Level Security
-- ============================================

alter table sedes enable row level security;
alter table horarios_disponibles enable row level security;
alter table citas enable row level security;

-- Cualquiera puede LEER sedes y horarios disponibles (público)
create policy "sedes: lectura publica"
  on sedes for select
  using (true);

create policy "horarios: lectura publica"
  on horarios_disponibles for select
  using (true);

-- Cualquiera puede INSERTAR una cita (reservar) — validación real la hace un trigger
create policy "citas: insertar publico"
  on citas for insert
  with check (true);

-- Nadie sin sesión puede leer/editar citas directamente (eso lo hace el admin autenticado)
create policy "citas: lectura solo admin"
  on citas for select
  using (auth.role() = 'authenticated');

create policy "citas: update solo admin"
  on citas for update
  using (auth.role() = 'authenticated');

-- Solo admin autenticado puede crear/editar/borrar horarios
create policy "horarios: insert solo admin"
  on horarios_disponibles for insert
  with check (auth.role() = 'authenticated');

create policy "horarios: update solo admin"
  on horarios_disponibles for update
  using (auth.role() = 'authenticated');

create policy "horarios: delete solo admin"
  on horarios_disponibles for delete
  using (auth.role() = 'authenticated');

-- ============================================
-- Trigger: al reservar, marcar el horario como no disponible
-- (evita doble-reserva del mismo slot)
-- ============================================

create or replace function marcar_horario_ocupado()
returns trigger as $$
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
$$ language plpgsql security definer;

create trigger trg_marcar_horario_ocupado
before insert on citas
for each row execute function marcar_horario_ocupado();

-- Si se cancela una cita, liberar el horario de nuevo
create or replace function liberar_horario_si_cancela()
returns trigger as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    update horarios_disponibles
    set disponible = true
    where id = new.horario_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_liberar_horario
after update on citas
for each row execute function liberar_horario_si_cancela();

-- ============================================
-- Realtime: habilitar la tabla citas para el panel de admin
-- ============================================
alter publication supabase_realtime add table citas;
