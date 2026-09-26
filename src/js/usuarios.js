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
import { llenarSelectSedes, nombreSede, getSedes } from "./sedes.js";
import { cargarCitas } from "./panel.js";
import { cargarNotificaciones } from "./notificaciones.js";

export function initUsuarios() {
  const form = document.getElementById("form-nuevo-usuario");
  if (form) form.addEventListener("submit", onCrearUsuario);
}

export async function prepararUsuarios() {
  if (!esAdmin()) return;
  llenarSelectSedes(document.getElementById("nuevo-usuario-sede"), {
    incluirTodas: false,
    incluirAmbas: true,
  });
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
  info.appendChild(chips);

  // La sede del trabajador se edita aquí mismo, y al cambiarla se reacomodan
  // solos los correos de aviso que recibe. En el admin no se muestra: por
  // definición ve y recibe todo.
  if (u.rol !== "admin") {
    const fila = document.createElement("label");
    fila.className = "usuario-sede";
    fila.textContent = "Sede que gestiona";

    const sel = document.createElement("select");
    sel.className = "select-sede-usuario";
    llenarSelectSedes(sel, { incluirAmbas: true });
    sel.value = u.sede_id ?? "ambas";
    sel.addEventListener("change", () => cambiarSedeUsuario(u, sel));
    fila.appendChild(sel);
    info.appendChild(fila);

    const avisos = document.createElement("span");
    avisos.className = "usuario-avisos";
    avisos.textContent = u.activo
      ? `Recibe los avisos de ${listarNombres(sedesDe(u.sede_id))}.`
      : "Inactivo: no recibe avisos.";
    info.appendChild(avisos);
  }

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
    btn.addEventListener("click", () => alternarUsuario(u, !u.activo));
    acciones.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

async function alternarUsuario(u, activo) {
  const { error } = await supabase.from("perfiles").update({ activo }).eq("id", u.id);
  if (error) {
    showToast("No se pudo actualizar el usuario.", "error");
    console.error(error);
    return;
  }

  // Un trabajador desactivado deja de recibir los avisos; al reactivarlo se le
  // devuelven los de su sede. Si no, seguirían llegándole datos de socios a
  // alguien que ya no trabaja acá.
  const cambio = await sincronizarCorreos(u.email, u.sede_id, activo);

  showToast(activo
    ? `Usuario activado. Vuelve a recibir los avisos de ${listarNombres(sedesDe(u.sede_id))}.`
    : "Usuario desactivado. Ya no recibirá avisos.");
  if (!cambio.ok) showToast("El usuario cambió, pero no se pudieron ajustar sus correos.", "error");

  await cargarUsuarios();
  await cargarNotificaciones();
  await cargarCitas();
}

// Cambia la sede del trabajador y arrastra con ella sus correos de aviso.
async function cambiarSedeUsuario(u, select) {
  const elegida = select.value === "ambas" ? null : select.value;
  if (elegida === (u.sede_id ?? null)) return;

  select.disabled = true;
  const { error } = await supabase.from("perfiles").update({ sede_id: elegida }).eq("id", u.id);

  if (error) {
    showToast("No se pudo cambiar la sede.", "error");
    console.error(error);
    select.value = u.sede_id ?? "ambas";
    select.disabled = false;
    return;
  }

  const cambio = await sincronizarCorreos(u.email, elegida, u.activo);
  select.disabled = false;

  if (!cambio.ok) {
    showToast("Sede cambiada, pero no se pudieron ajustar sus correos.", "error");
  } else if (!u.activo) {
    showToast("Sede cambiada. Como está inactivo, no recibe avisos.");
  } else {
    showToast(`Sede cambiada. Ahora recibe los avisos de ${listarNombres(sedesDe(elegida))}.`);
  }

  await cargarUsuarios();
  await cargarNotificaciones();
}

// ---------- correos de aviso atados a la sede del trabajador ----------
// Regla: un trabajador ACTIVO recibe los avisos de la sede que gestiona, y los
// de las dos si gestiona ambas. Uno inactivo no recibe ninguno. Esta función
// deja `notificaciones_sede` exactamente así para ese correo, sin tocar los
// correos de nadie más (el Gmail de BioFit, el personal de Luis, etc.).

function sedesDe(sedeId) {
  return sedeId ? [sedeId] : getSedes().map((s) => s.id);
}

function listarNombres(ids) {
  const nombres = ids.map(nombreSede);
  if (nombres.length <= 1) return nombres.join("") || "ninguna sede";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export async function sincronizarCorreos(email, sedeId, activo) {
  const objetivo = new Set(activo ? sedesDe(sedeId) : []);

  const { data: actuales, error } = await supabase
    .from("notificaciones_sede")
    .select("id, sede_id")
    .eq("email", email);

  if (error) {
    console.error("No se pudieron leer los correos del usuario:", error);
    return { ok: false };
  }

  const yaTiene = new Set((actuales || []).map((r) => r.sede_id));
  const sobran = (actuales || []).filter((r) => !objetivo.has(r.sede_id));
  const faltan = [...objetivo].filter((id) => !yaTiene.has(id));

  if (sobran.length > 0) {
    const { error: errBorrar } = await supabase
      .from("notificaciones_sede")
      .delete()
      .in("id", sobran.map((r) => r.id));
    if (errBorrar) {
      console.error("No se pudieron quitar los correos que sobraban:", errBorrar);
      return { ok: false };
    }
  }

  // Uno por uno: en un insert de varias filas, un choque con la restricción
  // única (sede_id, email) tumbaría también las demás.
  for (const sede of faltan) {
    const { error: errAlta } = await supabase
      .from("notificaciones_sede")
      .insert({ sede_id: sede, email });
    // 23505 = ya estaba. No es un fallo: es justo el estado que queríamos.
    if (errAlta && errAlta.code !== "23505") {
      console.error("No se pudo agregar el correo del usuario:", errAlta);
      return { ok: false };
    }
  }

  return { ok: true, agregadas: faltan, quitadas: sobran.map((r) => r.sede_id) };
}

async function onCrearUsuario(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("usuario-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const sede = fd.get("sede");
  const payload = {
    email: fd.get("email").trim(),
    password: fd.get("password"),
    nombre: fd.get("nombre").trim(),
    // "ambas" viaja como null: es la convención de la base para "todas las sedes".
    sede_id: sede === "ambas" ? null : sede,
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

    // Recién creado: entra de una vez a los correos de aviso de su sede.
    const correos = await sincronizarCorreos(payload.email, payload.sede_id, true);
    showToast(correos.ok
      ? `Trabajador creado. Recibirá los avisos de ${listarNombres(sedesDe(payload.sede_id))}.`
      : "Trabajador creado, pero no se pudieron configurar sus correos de aviso.");

    await cargarUsuarios();
    await cargarNotificaciones();
  } catch (err) {
    console.error(err);
    errorEl.textContent =
      "No se pudo contactar al servidor. ¿Está desplegada la función `crear-usuario`?";
    errorEl.classList.remove("hidden");
  } finally {
    setLoading(submitBtn, false);
  }
}
