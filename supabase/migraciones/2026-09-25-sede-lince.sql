-- ============================================================
-- BioFit — Tercera sede: Lince
-- Fecha: 25/09/2026
-- ✅ APLICADA en produccion el 25/09/2026 por Claude Code.
-- ============================================================
--
-- Es un INSERT de datos, no un cambio de estructura: `supabase/schema.sql` no
-- cambia. Queda escrito aqui para que exista rastro de como se creo la fila.
--
-- ⚠️ POR QUE ESTA SEDE NO LLEVA COORDENADAS
-- De Magdalena y Jesus Maria se conocen lat/lng. Del link que paso Christopher
-- (maps.app.goo.gl) no salen: redirige a una URL con el nombre y un `ftid`, no
-- con coordenadas. Inventar un lat/lng cercano manda al socio a la cuadra
-- equivocada, asi que las dos URLs buscan el local por texto y dejan que Google
-- lo resuelva. Verificado antes de cargarlo: las dos responden 200, y la de
-- `output=embed` no trae X-Frame-Options en la respuesta final (solo en el
-- redirect, que no cuenta) — exactamente igual que las dos que ya funcionan.
--
-- Si algun dia se consiguen las coordenadas exactas, se cambian con un UPDATE
-- y el frontend las toma solo: no hay nada que tocar en el codigo.

insert into sedes (id, nombre, direccion, color, mapa_embed, maps_url)
values (
  'lince',
  'Sede Lince',
  'Av. Petit Thouars 1860, Lince',
  '#147362',   -- teal del logo de BioFit, pedido por Christopher
  'https://www.google.com/maps?q=XFLY+Lince,+Av.+Petit+Thouars+1860,+Lince&hl=es&z=17&output=embed',
  'https://www.google.com/maps/dir/?api=1&destination=XFLY+Lince%2C+Av.+Petit+Thouars+1860%2C+Lince%2C+Lima'
)
on conflict (id) do nothing;


-- ============================================================
-- PARA REVERTIR
-- ============================================================
-- Solo si la sede NO tiene horarios ni citas todavia (las FK lo impiden si los
-- tiene, que es justo lo que uno quiere):
--
--   delete from notificaciones_sede where sede_id = 'lince';
--   delete from sedes where id = 'lince';
-- ============================================================
