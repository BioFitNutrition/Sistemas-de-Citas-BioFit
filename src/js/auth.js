// ============================================
// Autenticación y detección de rol
// ============================================
// Solo el administrador y el trabajador inician sesión.
// El socio (cliente) NO tiene credenciales: reserva de forma anónima.

import { supabase } from "./supabaseClient.js";

// Perfil del usuario con sesión activa: { id, email, nombre, rol, sede_id, activo }
let _perfil = null;

export function getPerfil() {
  return _perfil;
}

export function esAdmin() {
  return _perfil?.rol === "admin";
}

export function esTrabajador() {
  return _perfil?.rol === "trabajador";
}

export function miSede() {
  return _perfil?.sede_id ?? null;
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
    .select("id, email, nombre, rol, sede_id, activo")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar el perfil:", error);
    _perfil = null;
    return null;
  }

  // Un usuario sin perfil, o desactivado, no debe entrar al panel.
  if (!data || data.activo !== true) {
    _perfil = null;
    return null;
  }

  _perfil = data;
  return _perfil;
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
