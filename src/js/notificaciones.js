// ============================================
// Correos de notificación por sede — SOLO ADMIN
// ============================================
// Luis decide desde el panel qué correos reciben el aviso de cada sede.
// Nada de correos escritos a fuego en el código.

import { supabase } from "./supabaseClient.js";
import { esAdmin } from "./auth.js";
import { showToast, setLoading, emailValido } from "./utils.js";
import { llenarSelectSedes, chipSede } from "./sedes.js";

export function initNotificaciones() {
  const form = document.getElementById("form-nueva-notificacion");
  if (form) form.addEventListener("submit", onAgregarCorreo);
}

export async function prepararNotificaciones() {
  if (!esAdmin()) return;
  llenarSelectSedes(document.getElementById("nueva-notificacion-sede"), { incluirTodas: false });
  await cargarNotificaciones();
}

export async function cargarNotificaciones() {
  const listEl = document.getElementById("notificaciones-list");
  if (!listEl) return;
  listEl.innerHTML = '<p class="loading">Cargando correos...</p>';

  const { data, error } = await supabase
    .from("notificaciones_sede")
    .select("id, sede_id, email, activo")
    .order("sede_id")
    .order("email");

  if (error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar los correos.</p>';
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML =
      '<p class="empty-state">No hay correos configurados. Agrega uno arriba para recibir los avisos.</p>';
    return;
  }

  listEl.innerHTML = "";
  data.forEach((n) => listEl.appendChild(renderCorreo(n)));
}

function renderCorreo(n) {
  const row = document.createElement("div");
  row.className = "card-row";

  const info = document.createElement("div");
  info.className = "info";

  const correo = document.createElement("strong");
  correo.textContent = n.email;
  info.appendChild(correo);

  const chips = document.createElement("div");
  chips.className = "card-row__chips";
  chips.appendChild(chipSede(n.sede_id));
  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const estado = document.createElement("span");
  estado.className = `badge badge-${n.activo ? "libre" : "ocupado"}`;
  estado.textContent = n.activo ? "Recibiendo" : "Pausado";
  acciones.appendChild(estado);

  const toggle = document.createElement("button");
  toggle.className = "btn-small secondary";
  toggle.textContent = n.activo ? "Pausar" : "Reactivar";
  toggle.addEventListener("click", () => alternarCorreo(n.id, !n.activo));
  acciones.appendChild(toggle);

  const borrar = document.createElement("button");
  borrar.className = "btn-small";
  borrar.textContent = "Quitar";
  borrar.addEventListener("click", () => quitarCorreo(n.id, n.email));
  acciones.appendChild(borrar);

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

async function onAgregarCorreo(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("notificacion-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const email = fd.get("email").trim();

  if (!emailValido(email)) {
    errorEl.textContent = "Ingresa un correo electrónico válido.";
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Agregando...");

  const { error } = await supabase.from("notificaciones_sede").insert({
    sede_id: fd.get("sede"),
    email,
  });

  setLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = error.code === "23505"
      ? "Ese correo ya está configurado para esta sede."
      : "No se pudo agregar el correo.";
    errorEl.classList.remove("hidden");
    console.error(error);
    return;
  }

  form.reset();
  showToast("Correo agregado.");
  cargarNotificaciones();
}

async function alternarCorreo(id, activo) {
  const { error } = await supabase.from("notificaciones_sede").update({ activo }).eq("id", id);
  if (error) {
    showToast("No se pudo actualizar el correo.", "error");
    console.error(error);
    return;
  }
  cargarNotificaciones();
}

async function quitarCorreo(id, email) {
  if (!window.confirm(`¿Quitar ${email} de los avisos de esta sede?`)) return;

  const { error } = await supabase.from("notificaciones_sede").delete().eq("id", id);
  if (error) {
    showToast("No se pudo quitar el correo.", "error");
    console.error(error);
    return;
  }
  showToast("Correo quitado.");
  cargarNotificaciones();
}
