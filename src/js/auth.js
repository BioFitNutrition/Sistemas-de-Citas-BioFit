// ============================================
// Autenticación y detección de rol
// ============================================
// Solo el administrador y el trabajador inician sesión.
// El socio (cliente) NO tiene credenciales: reserva de forma anónima.

import { supabase } from "./supabaseClient.js";

// Perfil del usuario con sesión activa: { id, email, nombre, rol, activo }
let _perfil = null;

// Sedes que gestiona el usuario. Para el admin es `null`, que significa TODAS;
// para el trabajador, la lista exacta que le marcó el admin (puede estar vacía).
// Sale de `perfil_sedes`, no de `perfiles.sede_id`, que quedó en desuso.
let _misSedes = null;

export function getPerfil() {
  return _perfil;
}

export function esAdmin() {
  return _perfil?.rol === "admin";
}

export function esTrabajador() {
  return _perfil?.rol === "trabajador";
}

export function misSedes() {
  return _misSedes;
}

// Vuelve a leer las sedes del usuario con sesión abierta. La usa el realtime:
// si el admin le cambia las sedes mientras está dentro, su panel se reacomoda
// sin que tenga que cerrar sesión.
export async function recargarMisSedes() {
  if (!_perfil) return null;
  _misSedes = _perfil.rol === "admin" ? null : await leerMisSedes(_perfil.id);
  return _misSedes;
}

// Lee el perfil del usuario autenticado.
// Las políticas RLS permiten que cada usuario vea su propia fila de `perfiles`.
export async function cargarPerfil() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    _perfil = null;
    return null;
  }

  const { data, error } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, activo")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar el perfil:", error);
    _perfil = null;
    _misSedes = null;
    return null;
  }

  // Un usuario sin perfil, o desactivado, no debe entrar al panel.
  if (!data || data.activo !== true) {
    _perfil = null;
    _misSedes = null;
    return null;
  }

  _perfil = data;
  _misSedes = data.rol === "admin" ? null : await leerMisSedes(data.id);
  return _perfil;
}

// RLS deja que cada uno lea sus propias filas de `perfil_sedes`.
// Si la consulta falla se devuelve [] y no null: null significa "todas", y ante
// un error de red es mucho peor abrirle todo que mostrarle de menos.
async function leerMisSedes(perfilId) {
  const { data, error } = await supabase
    .from("perfil_sedes")
    .select("sede_id")
    .eq("perfil_id", perfilId);

  if (error) {
    console.error("No se pudieron leer las sedes del usuario:", error);
    return [];
  }
  return (data || []).map((f) => f.sede_id);
}

export async function iniciarSesion(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, motivo: "credenciales" };

  const perfil = await cargarPerfil();
  if (!perfil) {
    // Tiene credenciales válidas pero no tiene perfil activo: no puede pasar.
    await supabase.auth.signOut();
    return { ok: false, motivo: "sin_perfil" };
  }
  return { ok: true, perfil };
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
  _perfil = null;
}

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_evento, session) => {
    if (!session) _perfil = null;
    callback(session);
  });
}
