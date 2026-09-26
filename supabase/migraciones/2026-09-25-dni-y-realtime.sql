-- ============================================================
-- BioFit — DNI del socio y Realtime en las demas tablas
-- Fecha: 25/09/2026
-- ✅ APLICADAS en produccion el 25/09/2026 por Claude Code
--    (`citas_dni_cliente` y `realtime_sedes_horarios_perfil_sedes`).
-- ============================================================

-- ---------- 1. DNI del socio (punto 14 de TAREAS.md) ----------
-- NULLABLE a proposito: ya habia 31 citas sin DNI y una columna NOT NULL
-- rompia la migracion. La obligatoriedad (8 digitos) se exige en el formulario.
alter table citas add column if not exists dni_cliente text;

comment on column citas.dni_cliente is
  'DNI del socio, 8 digitos. Nullable: las citas anteriores al 25/09/2026 no lo tienen. El formulario si lo exige.';


-- ---------- 2. Realtime para las demas tablas ----------
-- ⚠️ Hasta hoy la publicacion solo tenia `citas`, asi que suscribirse a las
-- otras desde el frontend no hacia NADA — y sin dar ningun error.
alter publication supabase_realtime add table sedes;
alter publication supabase_realtime add table horarios_disponibles;
alter publication supabase_realtime add table perfil_sedes;


-- ============================================================
-- PARA REVERTIR
-- ============================================================
--   alter publication supabase_realtime drop table perfil_sedes;
--   alter publication supabase_realtime drop table horarios_disponibles;
--   alter publication supabase_realtime drop table sedes;
--
--   -- El DNI solo si de verdad se quiere perder el dato:
--   alter table citas drop column dni_cliente;
-- ============================================================
