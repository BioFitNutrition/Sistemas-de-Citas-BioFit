-- ============================================================
-- BIOFIT — Esquema REAL de la base de datos
-- Proyecto Supabase: snuefzvfhucgfllnifat (São Paulo)
-- ============================================================
-- Volcado el 26/09/2026 directamente desde la base en producción.
-- Refleja el estado EXACTO de ese momento.
--
-- ⚠️ DOCUMENTACIÓN — NO EJECUTAR CONTRA LA BASE DE PRODUCCIÓN.
--    Sirve para entender el contrato y, si algún día hiciera falta,
--    reconstruir el esquema desde cero en un proyecto nuevo.
--
-- ⚠️⚠️ ESTE REPOSITORIO ES PÚBLICO.
--    Si vuelcas el esquema de nuevo, NUNCA copies literal el cuerpo de
--    notificar_cita(): lleva el WEBHOOK_SECRET embebido. Abajo está
--    reemplazado por un marcador. El valor real vive solo en la base y
--    en los secretos de la Edge Function.
-- ============================================================


-- ============================================================
-- 1. TABLAS
-- ============================================================

-- ---- Sedes (2 filas fijas) ----
create table sedes (
  id         text primary key,      -- 'magdalena' | 'jesus_maria'
  nombre     text not null,
  direccion  text,
  color      text,                  -- color distintivo de la sede
  mapa_embed text,                  -- src del <iframe> del mini mapa
  maps_url   text                   -- href del botón "Cómo llegar"
);

-- Valores actuales:
--   magdalena    'Sede Magdalena del Mar'  'Av. del Ejército 1360, Magdalena del Mar'  #16a34a
--   jesus_maria  'Sede Jesús María'        'Av. General Garzón 1123, Jesús María'      #eab308
--
-- Los mapas NO usan API key de Google (la Embed API oficial exige cuenta de
-- facturación con tarjeta, y el proyecto no puede tener eso):
--   mapa_embed → https://www.google.com/maps?q=LAT,LNG(Etiqueta)&hl=es&z=17&output=embed
--   maps_url   → https://www.google.com/maps/dir/?api=1&destination=LAT,LNG   (API oficial)


-- ---- Perfiles: quién tiene credenciales y con qué rol ----
-- El socio NO aparece acá: reserva de forma anónima, sin cuenta.
create table perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text,
  rol        text not null default 'trabajador'
             check (rol in ('admin','trabajador')),
  -- ⚠️ EN DESUSO desde el 25/09/2026: la reemplazó `perfil_sedes`, porque una
  -- sola columna no puede decir "dos de tres sedes". Ni el frontend ni las
  -- políticas RLS la leen; se conserva solo para poder revertir.
  sede_id    text references sedes(id),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_perfiles_rol  on perfiles (rol);
create index idx_perfiles_sede on perfiles (sede_id);


-- ---- Qué sedes gestiona cada trabajador ----
-- Una fila por sede. Es un conjunto EXPLÍCITO: no existe un "todas" que se
-- estire solo. Si BioFit abre una sede nueva, nadie la gestiona hasta que el
-- admin la marque, y eso es a propósito: nadie debe ganar acceso a las citas de
-- un local sin que alguien lo decida.
--
-- El admin NO aparece acá: sus permisos salen de `es_admin()`, no de esta tabla.
create table perfil_sedes (
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  sede_id    text not null references sedes(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (perfil_id, sede_id)
);

create index idx_perfil_sedes_perfil on perfil_sedes (perfil_id);


-- ---- Horarios que el equipo habilita ----
create table horarios_disponibles (
  id         uuid primary key default gen_random_uuid(),
  sede_id    text not null references sedes(id),
  fecha      date not null,
  hora       time not null,
  disponible boolean not null default true,
  created_at timestamptz not null default now(),
  creado_por uuid references perfiles(id) on delete set null
             default auth.uid(),        -- lo fija un trigger, no el frontend
  unique (sede_id, fecha, hora)
);

create index idx_horarios_sede_fecha on horarios_disponibles (sede_id, fecha);
create index idx_horarios_creado_por on horarios_disponibles (creado_por);


-- ---- Citas reservadas por los socios ----
create table citas (
  id               uuid primary key default gen_random_uuid(),
  horario_id       uuid not null references horarios_disponibles(id),
  sede_id          text not null references sedes(id),
  nombre_cliente   text not null,
  telefono_cliente text not null,
  email_cliente    text,
  -- 8 digitos. NULLABLE a proposito: las 31 citas anteriores al 25/09/2026 no
  -- tienen DNI, y una columna NOT NULL rompia la migracion. La obligatoriedad
  -- se exige en el formulario del socio, no en la tabla.
  dni_cliente      text,
  fecha            date not null,
  hora             time not null,
  estado           text not null default 'confirmada',  -- 'confirmada' | 'cancelada'
  created_at       timestamptz not null default now(),
  -- ⚠️ EN DESUSO desde el 25/09/2026: era la delegación cita por cita, que se
  -- eliminó. Se conserva como historial; el frontend no la escribe ni la lee.
  asignado_a       uuid references perfiles(id) on delete set null
);

create index idx_citas_sede_fecha on citas (sede_id, fecha);
create index idx_citas_asignado   on citas (asignado_a);

-- ⚠️ citas.horario_id NO tiene ON DELETE. Por lo tanto un horario con
--    CUALQUIER cita apuntándolo no se puede borrar, aunque esa cita esté
--    cancelada y el horario figure como libre. La interfaz debe deshabilitar
--    su casilla en vez de dejar que Postgres rechace el borrado.


-- ---- Correos que reciben el aviso interno, por sede ----
create table notificaciones_sede (
  id         uuid primary key default gen_random_uuid(),
  sede_id    text not null references sedes(id) on delete cascade,
  email      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sede_id, email)
);

create index idx_notif_sede on notificaciones_sede (sede_id) where activo;


-- ============================================================
-- 2. FUNCIONES HELPER (las usan las políticas RLS)
-- ============================================================
-- SECURITY DEFINER es indispensable: sin él, consultar `perfiles` dentro de
-- una política RLS de `perfiles` provocaría recursión infinita.
-- El search_path fijo evita el secuestro de search_path.
-- Todas filtran por activo = true.

create or replace function mi_rol() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select rol from perfiles where id = auth.uid() and activo = true;
$$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from perfiles
                 where id = auth.uid() and rol = 'admin' and activo = true);
$$;

create or replace function es_trabajador() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from perfiles
                 where id = auth.uid() and rol = 'trabajador' and activo = true);
$$;

-- Las sedes del usuario actual, una por fila. Reemplazó a mi_sede() el
-- 25/09/2026; se usa como `sede_id in (select mis_sedes())`.
create or replace function mis_sedes() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select ps.sede_id
    from perfil_sedes ps
    join perfiles p on p.id = ps.perfil_id
   where ps.perfil_id = auth.uid() and p.activo;
$$;

-- ⚠️ `mi_sede()` sigue existiendo pero YA NO LA USA NADIE: lee
-- `perfiles.sede_id`, que quedó en desuso. No volver a apoyarse en ella.
create or replace function mi_sede() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select sede_id from perfiles where id = auth.uid() and activo = true;
$$;

revoke all on function mi_rol(), es_admin(), es_trabajador(), mi_sede(), mis_sedes()
  from anon, public;
grant execute on function mi_rol(), es_admin(), es_trabajador(), mi_sede(), mis_sedes()
  to authenticated;


-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- ---- Anti doble-booking: marca el horario ocupado en la MISMA transacción.
create or replace function marcar_horario_ocupado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update horarios_disponibles set disponible = false
  where id = new.horario_id and disponible = true;
  if not found then
    raise exception 'Este horario ya no está disponible';
  end if;
  return new;
end;
$$;

create trigger trg_marcar_horario_ocupado
before insert on citas for each row execute function marcar_horario_ocupado();


-- ---- Al cancelar, libera el horario.
create or replace function liberar_horario_si_cancela() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    update horarios_disponibles set disponible = true where id = new.horario_id;
  end if;
  return new;
end;
$$;

create trigger trg_liberar_horario
after update on citas for each row execute function liberar_horario_si_cancela();


-- ---- Firma el horario con su autor real.
-- Pisa lo que venga del cliente a propósito: si el frontend mandara creado_por,
-- cualquiera podría atribuirle un horario a otra persona.
create or replace function fijar_creador_horario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.creado_por := auth.uid();
  return new;
end;
$$;

create trigger trg_fijar_creador_horario
before insert on horarios_disponibles
for each row execute function fijar_creador_horario();


-- ---- Dispara los correos llamando a la Edge Function notify-cita.
create or replace function notificar_cita() returns trigger
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  url_funcion text := 'https://snuefzvfhucgfllnifat.supabase.co/functions/v1/notify-cita';
  secreto     text := '<<<WEBHOOK_SECRET — valor real solo en la base, NO publicar>>>';
  cuerpo      jsonb;
begin
  if tg_op = 'INSERT' then
    cuerpo := jsonb_build_object('type','INSERT','record', to_jsonb(new));
  else
    -- Solo avisamos cuando la cita pasa a estar asignada a alguien distinto.
    if new.asignado_a is null
       or new.asignado_a is not distinct from old.asignado_a
       or new.estado = 'cancelada' then
      return new;
    end if;
    cuerpo := jsonb_build_object('type','UPDATE','record', to_jsonb(new),
                                 'old_record', to_jsonb(old));
  end if;

  perform net.http_post(
    url     := url_funcion,
    body    := cuerpo,
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-webhook-secret', secreto),
    timeout_milliseconds := 8000
  );
  return new;
end;
$$;

create trigger trg_notificar_cita_nueva
after insert on citas for each row execute function notificar_cita();

-- Inofensivo pero ya muerto: nada vuelve a escribir `asignado_a`, así que nunca
-- se dispara. Hay que quitarlo ANTES de borrar la columna algún día.
create trigger trg_notificar_cita_delegada
after update of asignado_a on citas for each row execute function notificar_cita();

-- Son funciones de trigger: no deben poder invocarse desde la API REST.
revoke all on function marcar_horario_ocupado(), liberar_horario_si_cancela(),
                      fijar_creador_horario(), notificar_cita()
  from anon, authenticated, public;

-- ⚠️ notify-cita responde 200 de inmediato y manda el correo en segundo plano
--    con EdgeRuntime.waitUntil. NO cambiar ese patrón: pg_net corta la espera a
--    los 8000 ms (arriba) y conectarse a Gmail tarda ~6 s. Ya se rompió una vez.


-- ============================================================
-- 4. ROW LEVEL SECURITY  (18 políticas, todas activas)
-- ============================================================

alter table sedes                enable row level security;
alter table perfiles             enable row level security;
alter table horarios_disponibles enable row level security;
alter table citas                enable row level security;
alter table perfil_sedes         enable row level security;
alter table notificaciones_sede  enable row level security;


-- ---- SEDES ---- (el socio necesita verlas sin sesión)
create policy "sedes: lectura publica"
  on sedes for select using (true);
create policy "sedes: solo admin actualiza"
  on sedes for update to authenticated
  using (es_admin()) with check (es_admin());


-- ---- PERFILES ----
create policy "perfiles: ver propio o admin ve todos"
  on perfiles for select to authenticated
  using (id = auth.uid() or es_admin());
create policy "perfiles: solo admin inserta"
  on perfiles for insert to authenticated with check (es_admin());
create policy "perfiles: solo admin actualiza"
  on perfiles for update to authenticated
  using (es_admin()) with check (es_admin());
create policy "perfiles: solo admin elimina"
  on perfiles for delete to authenticated using (es_admin());

-- ⚠️ CONSECUENCIA PARA LA INTERFAZ: al hacer join con perfiles, un TRABAJADOR
--    solo recibe su propia fila; los demás nombres le vuelven NULL. No es un
--    bug ni se arregla tocando RLS — hay que manejar el NULL en pantalla.


-- ---- PERFIL_SEDES ----
-- El trabajador necesita LEER las suyas: con eso se configura su panel (qué
-- sedes le salen en los selectores). Repartirlas es solo del admin.
-- No hay UPDATE a propósito: una fila se crea o se borra, nunca se edita.
create policy "perfil_sedes: ve las suyas, admin ve todas"
  on perfil_sedes for select to authenticated
  using (perfil_id = auth.uid() or es_admin());
create policy "perfil_sedes: solo admin asigna"
  on perfil_sedes for insert to authenticated with check (es_admin());
create policy "perfil_sedes: solo admin quita"
  on perfil_sedes for delete to authenticated using (es_admin());


-- ---- HORARIOS DISPONIBLES ---- (el socio necesita ver los libres)
create policy "horarios: lectura publica"
  on horarios_disponibles for select using (true);
create policy "horarios: admin todas, trabajador los de sus sedes (crear)"
  on horarios_disponibles for insert to authenticated
  with check (es_admin() or (es_trabajador()
              and sede_id in (select mis_sedes())));
create policy "horarios: admin todas, trabajador los de sus sedes (editar)"
  on horarios_disponibles for update to authenticated
  using      (es_admin() or (es_trabajador()
              and sede_id in (select mis_sedes())))
  with check (es_admin() or (es_trabajador()
              and sede_id in (select mis_sedes())));

-- ⚠️ OJO: el SELECT de esta tabla es PÚBLICO (el socio tiene que ver los cupos),
--    así que RLS no acota la LECTURA del trabajador. Recortarla a sus sedes es
--    trabajo del frontend, y no es cosmético: ver `cargarHorarios()` en panel.js.
create policy "horarios: solo admin elimina"
  on horarios_disponibles for delete to authenticated using (es_admin());


-- ---- CITAS ----
-- El socio puede CREAR sin sesión, pero NO puede leer ninguna: así los datos de
-- contacto de unos clientes no quedan expuestos a otros.
-- ⚠️ Es lo único que protege el nombre, teléfono y correo de los socios. El repo
--    es público y la anon key está publicada: cualquiera puede consultar la API.
--    NO abrir select ni update de `citas` a anon por ningún motivo. Si hace falta
--    que el socio cancele su cita, va por una función SECURITY DEFINER con token
--    aleatorio (ver TAREAS.md punto 15), nunca por una política abierta.
create policy "citas: reserva publica"
  on citas for insert to anon, authenticated with check (true);
create policy "citas: admin todas, trabajador las de sus sedes (ver)"
  on citas for select to authenticated
  using (es_admin() or (es_trabajador()
         and sede_id in (select mis_sedes())));
create policy "citas: admin todas, trabajador las de sus sedes (editar)"
  on citas for update to authenticated
  using      (es_admin() or (es_trabajador()
              and sede_id in (select mis_sedes())))
  with check (es_admin() or (es_trabajador()
              and sede_id in (select mis_sedes())));
create policy "citas: solo admin elimina"
  on citas for delete to authenticated using (es_admin());

-- Las sedes del trabajador mandan: ve las citas de las sedes que gestiona, y de
-- ninguna otra. Misma forma que `horarios_disponibles`, pero aquí RLS sí acota
-- la lectura, porque `citas` no es de lectura pública.
-- ⚠️ `citas.asignado_a` ya NO participa: la delegación cita por cita se eliminó
--    el 25/09/2026 y la columna queda solo como historial.


-- ---- NOTIFICACIONES POR SEDE ----
-- Solo el admin. La Edge Function las lee con service_role, que ignora RLS.
create policy "notificaciones: solo admin ve"
  on notificaciones_sede for select to authenticated using (es_admin());
create policy "notificaciones: solo admin inserta"
  on notificaciones_sede for insert to authenticated with check (es_admin());
create policy "notificaciones: solo admin actualiza"
  on notificaciones_sede for update to authenticated
  using (es_admin()) with check (es_admin());
create policy "notificaciones: solo admin elimina"
  on notificaciones_sede for delete to authenticated using (es_admin());


-- ============================================================
-- 5. REALTIME
-- ============================================================
alter publication supabase_realtime add table citas;


-- ============================================================
-- 6. MIGRACIONES APROBADAS QUE TODAVÍA NO SE APLICARON
-- ============================================================
-- Están decididas con Christopher pero NO existen aún en la base.
-- Avisarle antes de correr cualquiera.
--
--   citas.cancelada_por  uuid references perfiles(id)   -- TAREAS.md punto 7
--   citas.dni_cliente    text  (NULLABLE, no not null)  -- TAREAS.md punto 14
--
-- Y estas dependen de decisiones todavía abiertas (ver TAREAS.md):
--   punto 15 → token de cancelación para el socio
--   punto 16 → citas.evento_calendar_id (Google Calendar)
--   punto 17 → marcas de recordatorio enviado (pg_cron)


-- ============================================================
-- 6. REALTIME
-- ============================================================
-- Realtime SOLO emite lo que esta en esta publicacion. Suscribirse desde el
-- frontend a una tabla que no este aqui no da error: simplemente nunca llega
-- nada, y es dificil de notar.
--
--   citas                -> el panel se actualiza al entrar una reserva
--   horarios_disponibles -> refleja altas y bajas hechas por otro usuario
--   sedes                -> una sede nueva aparece sin recargar, en el panel y
--                           en la web del socio
--   perfil_sedes         -> si el admin le cambia las sedes a un trabajador que
--                           esta con el panel abierto, su pantalla se reacomoda
--
-- Respeta RLS: el trabajador sigue recibiendo solo sus filas, y `citas` sigue
-- cerrada para el anonimo.
--
--   alter publication supabase_realtime add table citas;
--   alter publication supabase_realtime add table horarios_disponibles;
--   alter publication supabase_realtime add table sedes;
--   alter publication supabase_realtime add table perfil_sedes;
