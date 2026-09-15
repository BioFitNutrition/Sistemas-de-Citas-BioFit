// ============================================
// Sedes — se leen de la BASE DE DATOS, no se hardcodean
// ============================================
// La tabla `sedes` trae nombre, direccion y color. El color es el requerimiento
// de Luis: Magdalena verde, Jesús María amarillo. Si mañana quiere cambiarlo,
// se cambia en la base y el frontend lo toma solo.

import { supabase } from "./supabaseClient.js";
import { COLOR_SEDE_DEFECTO } from "./config.js";

let _sedes = [];

export async function cargarSedes() {
  const { data, error } = await supabase
    .from("sedes")
    .select("id, nombre, direccion, color")
    .order("nombre");

  if (error) {
    console.error("No se pudieron cargar las sedes:", error);
    return [];
  }
  _sedes = data || [];
  return _sedes;
}

export function getSedes() {
  return _sedes;
}

export function getSede(sedeId) {
  return _sedes.find((s) => s.id === sedeId) || null;
}

export function nombreSede(sedeId) {
  return getSede(sedeId)?.nombre ?? sedeId;
}

export function direccionSede(sedeId) {
  return getSede(sedeId)?.direccion ?? "";
}

export function colorSede(sedeId) {
  return getSede(sedeId)?.color || COLOR_SEDE_DEFECTO;
}

// Pinta un <select> con las sedes disponibles.
// `incluirTodas` agrega la opción "Todas" al inicio (solo tiene sentido para admin).
export function llenarSelectSedes(select, { incluirTodas = false, soloSede = null } = {}) {
  if (!select) return;
  select.innerHTML = "";

  if (incluirTodas) {
    const opt = document.createElement("option");
    opt.value = "todas";
    opt.textContent = "Todas";
    select.appendChild(opt);
  }

  _sedes
    .filter((s) => !soloSede || s.id === soloSede)
    .forEach((sede) => {
      const opt = document.createElement("option");
      opt.value = sede.id;
      opt.textContent = sede.nombre;
      select.appendChild(opt);
    });
}

// Chip de color con el nombre de la sede, para las listas del panel.
export function chipSede(sedeId) {
  const span = document.createElement("span");
  span.className = "chip-sede";
  span.textContent = nombreSede(sedeId);
  span.style.setProperty("--chip-color", colorSede(sedeId));
  return span;
}
