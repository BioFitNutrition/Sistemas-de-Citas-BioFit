// ============================================
// Sedes — se leen de la BASE DE DATOS, no se hardcodean
// ============================================
// La tabla `sedes` trae nombre, direccion, color y los dos datos del mapa. El
// color es el requerimiento de Luis: Magdalena verde, Jesús María amarillo. Si
// mañana quiere cambiarlo —o si se muda de local— se cambia la fila en la base
// y el frontend lo toma solo: aquí no se escribe ninguna dirección ni URL.

import { supabase } from "./supabaseClient.js";
import { COLOR_SEDE_DEFECTO } from "./config.js";

let _sedes = [];

export async function cargarSedes() {
  const { data, error } = await supabase
    .from("sedes")
    .select("id, nombre, direccion, color, mapa_embed, maps_url")
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

// URL para el <iframe> del mini mapa. Formato `output=embed`, que funciona sin
// API key — la Maps Embed API oficial exige cuenta de facturación con tarjeta y
// este proyecto no puede tener eso. No cambiar por la API oficial.
export function mapaEmbedSede(sedeId) {
  return getSede(sedeId)?.mapa_embed || "";
}

// URL del botón "Cómo llegar". Esta sí es API oficial y documentada de Google
// (Maps URLs) y tampoco necesita key. Es el respaldo del iframe: si el mapa
// algún día deja de cargar, el socio igual tiene cómo llegar.
export function mapsUrlSede(sedeId) {
  return getSede(sedeId)?.maps_url || "";
}

// Pinta un <select> con las sedes disponibles.
// `incluirTodas` agrega la opción "Todas" al inicio: sirve para FILTRAR una lista.
// `incluirAmbas` agrega "Ambas sedes" al inicio: sirve para ELEGIR al crear algo
//   (un correo que recibe los avisos de las dos sedes, un trabajador que cubre
//   las dos). Son cosas distintas, por eso son dos opciones y no una.
export function llenarSelectSedes(
  select,
  { incluirTodas = false, incluirAmbas = false, soloSede = null } = {}
) {
  if (!select) return;
  select.innerHTML = "";

  if (incluirTodas) {
    const opt = document.createElement("option");
    opt.value = "todas";
    opt.textContent = "Todas";
    select.appendChild(opt);
  }

  if (incluirAmbas) {
    const opt = document.createElement("option");
    opt.value = "ambas";
    opt.textContent = "Ambas sedes";
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

// Chip para quien no está atado a una sola sede (sede_id = NULL en la base).
// No puede usar chipSede(null): no hay nombre ni color que leer.
export function chipAmbasSedes() {
  const span = document.createElement("span");
  span.className = "chip-sede";
  span.textContent = "Ambas sedes";
  span.style.setProperty("--chip-color", COLOR_SEDE_DEFECTO);
  return span;
}
