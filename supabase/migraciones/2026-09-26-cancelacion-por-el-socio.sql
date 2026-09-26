-- ============================================================
-- BioFit — El socio cancela su propia cita desde el correo
-- Fecha: 26/09/2026
-- Punto 15 de TAREAS.md (y cierra el 7).
--
-- ✅ APLICADA EN PRODUCCION el 26/09/2026, como migracion `cancelacion_por_el_socio`.
--    (Quedo escrita el mismo dia pero sin correr, porque Claude Code perdio el
--    acceso a Supabase a mitad de la sesion. Se corrio al recuperarlo.)
--
--    Verificado despues de aplicarla:
--      · las 4 columnas existen en `citas`
--      · 30 de 30 citas confirmadas recibieron token (las 7 canceladas no, y
--        asi debe ser)
--      · triggers: se creo trg_marcar_quien_cancelo y trg_notificar_cita_cancelada,
--        y se elimino trg_notificar_cita_delegada
--      · notificar_cita() ya emite el evento CANCELADA, y el WEBHOOK_SECRET
--        se releyo de la base sin pasar por el repositorio
--
-- DECISIONES DE CHRISTOPHER (26/09/2026)
--   · Plazo para cancelar: hasta 2 HORAS ANTES de la cita
--   · Se guarda SIEMPRE quien cancelo, venga de donde venga
--
-- COMO FUNCIONA
--   El correo de confirmacion lleva un boton con un TOKEN aleatorio, nunca el
--   id de la cita: los uuid no son secretos y con el id cualquiera podria
--   cancelar citas ajenas, o barrerlas a mano. El token son 64 caracteres hex
--   (256 bits) y se invalida en cuanto se usa.
--
--   El anonimo sigue SIN poder leer ni editar `citas`. Todo pasa por dos
--   funciones SECURITY DEFINER que solo aceptan el token.
-- ============================================================


-- ---------- 1. Columnas ----------

alter table citas
  add column if not exists token_cancelacion    text,
  add column if not exists cancelada_por        uuid references perfiles(id),
  add column if not exists cancelada_por_origen text,
  add column if not exists cancelada_en         timestamptz;

-- Se agrega aparte para que no reviente si la migracion se corre dos veces.
do $$
begin
  alter table citas add constraint citas_cancelada_origen_ck
    check (cancelada_por_origen in ('socio', 'trabajador', 'admin'));
exception when duplicate_object then
  raise notice 'La restriccion citas_cancelada_origen_ck ya existia.';
end $$;

comment on column citas.token_cancelacion is
  'Secreto del enlace de cancelacion que va en el correo del socio. Se pone en NULL al usarse. NO exponerlo en el frontend.';
comment on column citas.cancelada_por is
  'Perfil que cancelo, cuando lo hizo alguien con sesion. NULL si cancelo el socio: no tiene perfil.';
comment on column citas.cancelada_por_origen is
  'socio | trabajador | admin. Lo llena un trigger, no el frontend.';

-- Dos uuid concatenados y sin guiones = 64 caracteres hex. Se usa esto en vez de
-- gen_random_bytes() para no depender de que pgcrypto este instalado.
create or replace function nuevo_token_cancelacion() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') ||
         replace(gen_random_uuid()::text, '-', '');
$$;

alter table citas
  alter column token_cancelacion set default nuevo_token_cancelacion();

-- Las citas que ya existen tambien reciben uno. No estorba: sus correos ya se
-- mandaron sin el enlace, pero si Luis reenvia algo a mano, sirve.
update citas
   set token_cancelacion = nuevo_token_cancelacion()
 where token_cancelacion is null
   and estado = 'confirmada';

create unique index if not exists idx_citas_token
  on citas (token_cancelacion)
  where token_cancelacion is not null;


-- ---------- 2. Quien cancelo, siempre ----------
-- Lo llena la base, no el frontend: si lo mandara el frontend, un trabajador
-- podria decir que cancelo el admin. `auth.uid()` no se puede falsificar.
--
-- Cuando cancela el SOCIO, la cancelacion entra por una funcion SECURITY
-- DEFINER llamada por el anonimo: ahi `auth.uid()` es NULL y este trigger no
-- toca nada, porque la funcion ya dejo puesto el origen 'socio'.

create or replace function marcar_quien_cancelo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    new.cancelada_en := coalesce(new.cancelada_en, now());

    if auth.uid() is not null then
      new.cancelada_por        := auth.uid();
      new.cancelada_por_origen := coalesce(mi_rol(), 'trabajador');
    end if;

    -- El enlace del correo deja de servir en cuanto la cita queda cancelada.
    new.token_cancelacion := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_marcar_quien_cancelo on citas;
create trigger trg_marcar_quien_cancelo
  before update of estado on citas
  for each row execute function marcar_quien_cancelo();


-- ---------- 3. Las dos funciones que usa la pantalla publica ----------
-- ⚠️ NINGUNA devuelve el token, ni el id de la cita, ni el correo o telefono del
--    socio. Solo lo justo para que reconozca su cita antes de confirmar.

-- a) Ver la cita a partir del token
create or replace function cita_por_token(p_token text)
returns table (
  nombre_cliente  text,
  fecha           date,
  hora            time,
  sede_nombre     text,
  sede_direccion  text,
  estado          text,
  puede_cancelar  boolean,
  motivo          text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c      record;
  limite timestamptz;
begin
  if p_token is null or length(p_token) <> 64 then
    return;
  end if;

  select ci.nombre_cliente, ci.fecha, ci.hora, ci.estado,
         s.nombre as sede_nombre, s.direccion as sede_direccion
    into c
    from citas ci
    join sedes s on s.id = ci.sede_id
   where ci.token_cancelacion = p_token;

  if not found then
    return;              -- enlace invalido o ya usado: cero filas
  end if;

  -- La cita esta en hora de Lima; `now()` es timestamptz. Se convierte la hora
  -- local de la cita a un instante real y se le restan las 2 horas de plazo.
  limite := ((c.fecha + c.hora) at time zone 'America/Lima') - interval '2 hours';

  return query select
    c.nombre_cliente,
    c.fecha,
    c.hora,
    c.sede_nombre,
    c.sede_direccion,
    c.estado,
    (c.estado = 'confirmada' and now() < limite),
    case
      when c.estado = 'cancelada' then 'Esta cita ya estaba cancelada.'
      when now() >= limite then
        'Ya no se puede cancelar por aqui: faltan menos de 2 horas para tu cita. Escribenos y lo vemos.'
      else null
    end;
end $$;

-- b) Cancelarla
create or replace function cancelar_cita_por_token(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  c      record;
  limite timestamptz;
begin
  if p_token is null or length(p_token) <> 64 then
    return jsonb_build_object('ok', false, 'motivo', 'El enlace no es valido.');
  end if;

  -- FOR UPDATE: si el socio hace doble clic, la segunda espera y encuentra la
  -- cita ya cancelada en vez de cancelarla dos veces.
  select * into c from citas where token_cancelacion = p_token for update;

  if not found then
    return jsonb_build_object('ok', false,
      'motivo', 'Este enlace ya no sirve. Puede que la cita ya se haya cancelado.');
  end if;

  if c.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'Esta cita ya estaba cancelada.');
  end if;

  limite := ((c.fecha + c.hora) at time zone 'America/Lima') - interval '2 hours';

  if now() >= limite then
    return jsonb_build_object('ok', false,
      'motivo', 'Ya no se puede cancelar por aqui: faltan menos de 2 horas para tu cita. Escribenos y lo vemos.');
  end if;

  -- El origen se deja puesto ANTES de que corra trg_marcar_quien_cancelo, que
  -- no lo pisa porque aqui auth.uid() es NULL (lo llama el anonimo).
  -- El token lo borra ese mismo trigger, y trg_liberar_horario suelta el cupo.
  update citas
     set estado               = 'cancelada',
         cancelada_por_origen = 'socio',
         cancelada_en         = now()
   where id = c.id;

  return jsonb_build_object('ok', true);
end $$;

-- El socio no tiene sesion: estas dos las llama el rol `anon`. Es la unica
-- puerta que se le abre, y solo se pasa con el token.
revoke all on function cita_por_token(text)            from public;
revoke all on function cancelar_cita_por_token(text)   from public;
revoke all on function nuevo_token_cancelacion()       from public, anon;
grant execute on function cita_por_token(text)          to anon, authenticated;
grant execute on function cancelar_cita_por_token(text) to anon, authenticated;


-- ---------- 4. Avisar a la sede cuando cancela el socio ----------
-- `notificar_cita()` hoy se corta en seco si la cita quedo cancelada, asi que
-- una cancelacion no avisa a nadie. Hay que cambiarle esa condicion.
--
-- ⚠️ El cuerpo de esa funcion lleva el WEBHOOK_SECRET embebido, y este repo es
-- PUBLICO. Por eso NO se reescribe a mano: el bloque de abajo lee el secreto de
-- la funcion que ya existe en la base y lo vuelve a colocar. Asi el secreto
-- nunca pasa por el repositorio.

do $$
declare
  def     text;
  secreto text;
  url     text := 'https://snuefzvfhucgfllnifat.supabase.co/functions/v1/notify-cita';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notificar_cita';

  if def is null then
    raise exception 'No existe notificar_cita(): revisa el nombre antes de seguir.';
  end if;

  secreto := (regexp_match(def, 'secreto\s+text\s*:=\s*''([^'']*)'''))[1];

  if secreto is null or secreto = '' then
    raise exception 'No se pudo leer el WEBHOOK_SECRET de notificar_cita(). No se toca nada.';
  end if;

  execute format($f$
    create or replace function notificar_cita() returns trigger
    language plpgsql security definer set search_path = public, pg_temp, extensions as $body$
    declare
      url_funcion text := %L;
      secreto     text := %L;
      cuerpo      jsonb;
    begin
      if tg_op = 'INSERT' then
        cuerpo := jsonb_build_object('type','INSERT','record', to_jsonb(new));
      else
        -- Cancelacion: se avisa a los correos de la sede.
        if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
          cuerpo := jsonb_build_object('type','CANCELADA','record', to_jsonb(new),
                                       'old_record', to_jsonb(old));
        else
          return new;
        end if;
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
    $body$;
  $f$, url, secreto);

  raise notice 'notificar_cita() actualizada: ahora avisa tambien de las cancelaciones.';
end $$;

-- El trigger de delegacion queda sin efecto util (ya nadie escribe asignado_a),
-- y su condicion vieja desaparecio del cuerpo. Se reemplaza por uno de estado.
drop trigger if exists trg_notificar_cita_delegada on citas;

drop trigger if exists trg_notificar_cita_cancelada on citas;
create trigger trg_notificar_cita_cancelada
  after update of estado on citas
  for each row execute function notificar_cita();


-- ---------- 5. Comprobar como quedo ----------

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'citas'
   and column_name in ('token_cancelacion','cancelada_por','cancelada_por_origen','cancelada_en')
 order by column_name;

select tgname as trigger, pg_get_triggerdef(t.oid) as definicion
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where c.relname = 'citas' and not t.tgisinternal
 order by tgname;

select count(*) filter (where token_cancelacion is not null) as con_token,
       count(*)                                              as total
  from citas;


-- ============================================================
-- PARA REVERTIR
-- ============================================================
--   drop trigger if exists trg_notificar_cita_cancelada on citas;
--   drop trigger if exists trg_marcar_quien_cancelo on citas;
--   drop function if exists cancelar_cita_por_token(text);
--   drop function if exists cita_por_token(text);
--   drop function if exists marcar_quien_cancelo();
--   drop function if exists nuevo_token_cancelacion();
--   alter table citas
--     drop column if exists token_cancelacion,
--     drop column if exists cancelada_por,
--     drop column if exists cancelada_por_origen,
--     drop column if exists cancelada_en;
--
--   -- Y volver a dejar notificar_cita() como estaba (mismo truco del secreto):
--   -- en el `else`, salir cuando new.estado = 'cancelada'.
-- ============================================================
