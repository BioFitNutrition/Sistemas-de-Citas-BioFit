// ============================================
// Gestión de usuarios — SOLO ADMIN
// ============================================
// Crear un usuario en Supabase Auth requiere la service_role key, que NUNCA
// puede estar en el frontend (el repositorio es público). Por eso la creación
// pasa por la Edge Function `crear-usuario`, que valida que quien llama sea
// admin y usa la service_role del lado del servidor.

import { supabase } from "./supabaseClient.js";
import { SUPABASE_URL } from "./config.js";
import { esAdmin } from "./auth.js";
import { showToast, escapeHtml, setLoading } from "./utils.js";
import { llenarSelectSedes, nombreSede, chipSede } from "./sedes.js";
import { refrescarTrabajadores, cargarCitas } from "./panel.js";

export function initUsuarios() {
  const form = document.getElementById("form-nuevo-usuario");
  if (form) form.addEventListener("submit", onCrearUsuario);
}

export async function prepararUsuarios() {
  if (!esAdmin()) return;
  llenarSelectSedes(document.getElementById("nuevo-usuario-sede"), { incluirTodas: false });
  await cargarUsuarios();
}

export async function cargarUsuarios() {
  const listEl = document.getElementById("usuarios-list");
  if (!listEl) return;
  listEl.innerHTML = '<p class="loading">Cargando usuarios...</p>';

  const { data, error } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, sede_id, activo, created_at")
    .order("rol")
    .order("nombre");

  if (error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar los usuarios.</p>';
    console.error(error);
    return;
  }

  listEl.innerHTML = "";
  (data || []).forEach((u) => listEl.appendChild(renderUsuario(u)));
}

function renderUsuario(u) {
  const row = document.createElement("div");
  row.className = "card-row";

  const info = document.createElement("div");
  info.className = "info";

  const nombre = document.createElement("strong");
  nombre.textContent = u.nombre || u.email;
  info.appendChild(nombre);

  const correo = document.createElement("span");
  correo.textContent = u.email;
  info.appendChild(correo);

  const chips = document.createElement("div");
  chips.className = "card-row__chips";

  const rol = document.createElement("span");
  rol.className = `badge badge-${u.rol === "admin" ? "admin" : "trabajador"}`;
  rol.textContent = u.rol === "admin" ? "Administrador" : "Trabajador";
  chips.appendChild(rol);

  if (u.sede_id) chips.appendChild(chipSede(u.sede_id));
  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const estado = document.createElement("span");
  estado.className = `badge badge-${u.activo ? "libre" : "ocupado"}`;
  estado.textContent = u.activo ? "Activo" : "Inactivo";
  acciones.appendChild(estado);

  // El admin no se puede desactivar a sí mismo: se quedaría fuera del sistema.
  if (u.rol !== "admin") {
    const btn = document.createElement("button");
    btn.className = "btn-small secondary";
    btn.textContent = u.activo ? "Desactivar" : "Activar";
    btn.addEventListener("click", () => alternarUsuario(u.id, !u.activo));
    acciones.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

async function alternarUsuario(id, activo) {
  const { error } = await supabase.from("perfiles").update({ activo }).eq("id", id);
  if (error) {
    showToast("No se pudo actualizar el usuario.", "error");
    console.error(error);
    return;
  }
  showToast(activo ? "Usuario activado." : "Usuario desactivado.");
  await cargarUsuarios();
  await refrescarTrabajadores();
  await cargarCitas();
}

async function onCrearUsuario(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("usuario-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const payload = {
    email: fd.get("email").trim(),
    password: fd.get("password"),
    nombre: fd.get("nombre").trim(),
    sede_id: fd.get("sede"),
  };

  if (payload.password.length < 8) {
    errorEl.textContent = "La contraseña debe tener al menos 8 caracteres.";
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Creando...");

  try {
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/crear-usuario`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(payload),
    });

    const resultado = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = resultado?.error || "No se pudo crear el usuario.";
      errorEl.classList.remove("hidden");
      return;
    }

    form.reset();
    showToast("Trabajador creado.");
    await cargarUsuarios();
    await refrescarTrabajadores();
  } catch (err) {
    console.error(err);
    errorEl.textContent =
      "No se pudo contactar al servidor. ¿Está desplegada la función `crear-usuario`?";
    errorEl.classList.remove("hidden");
  } finally {
    setLoading(submitBtn, false);
  }
}
