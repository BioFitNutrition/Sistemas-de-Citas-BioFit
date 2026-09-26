// ============================================
// Sedes — se leen de la BASE DE DATOS, no se hardcodean
// ============================================
// La tabla `sedes` trae nombre, direccion, color y los dos datos del mapa. El
// color es el requerimiento de Luis: Magdalena verde, Jesús María amarillo. Si
// mañana quiere cambiarlo —o si se muda de local— se cambia la fila en la base
// y el frontend lo toma solo: aquí no se escribe ninguna dirección ni URL.

import { supabase } from "./supabaseClient.js";
import { COLOR_SEDE_DEFECTO } from "./config.js";
import { colorLegible, colorSuave } from "./utils.js";

// Valor centinela del <select> para "no atado a una sola sede". Nunca llega a la
// base: al guardar se traduce a NULL, que es como la base dice "todas".
export const TODAS_LAS_SEDES = "todas_las_sedes";

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
// `incluirTodasLasSedes` agrega "Todas las sedes" al inicio: sirve para ELEGIR
//   al crear algo (un correo que recibe los avisos de todas, un trabajador que
//   las cubre todas). Son cosas distintas, por eso son dos opciones y no una.
export function llenarSelectSedes(
  select,
  { incluirTodas = false, incluirTodasLasSedes = false, soloSede = null } = {}
) {
  if (!select) return;
  select.innerHTML = "";

  if (incluirTodas) {
    const opt = document.createElement("option");
    opt.value = "todas";
    opt.textContent = "Todas";
    select.appendChild(opt);
  }

  if (incluirTodasLasSedes) {
    const opt = document.createElement("option");
    opt.value = TODAS_LAS_SEDES;
    opt.textContent = "Todas las sedes";
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
  return armarChip(nombreSede(sedeId), colorSede(sedeId));
}

// El color de la sede va en el punto, el fondo y el borde; el TEXTO usa su
// variante oscurecida. Con el amarillo de Jesús María (#eab308) el color crudo
// sobre blanco da 1.9:1 y no se lee — la misma regla que en el calendario.
function armarChip(texto, color) {
  const span = document.createElement("span");
  span.className = "chip-sede";
  span.textContent = texto;
  span.style.setProperty("--chip-color", color);
  span.style.setProperty("--chip-texto", colorLegible(color));
  span.style.setProperty("--chip-fondo", colorSuave(color, 0.14));
  span.style.setProperty("--chip-borde", colorSuave(color, 0.45));
  return span;
}

// Chip para quien no está atado a una sola sede (sede_id = NULL en la base).
// No puede usar chipSede(null): no hay nombre ni color que leer.
export function chipTodasLasSedes() {
  return armarChip("Todas las sedes", COLOR_SEDE_DEFECTO);
}
