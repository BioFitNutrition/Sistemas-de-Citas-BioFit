// ============================================
// Correos de notificación por sede — SOLO ADMIN
// ============================================
// Luis decide desde el panel qué correos reciben el aviso de cada sede.
// Nada de correos escritos a fuego en el código.

import { supabase } from "./supabaseClient.js";
import { esAdmin } from "./auth.js";
import { showToast, setLoading, emailValido } from "./utils.js";
import { llenarSelectSedes, chipSede, getSedes, nombreSede } from "./sedes.js";

export function initNotificaciones() {
  const form = document.getElementById("form-nueva-notificacion");
  if (form) form.addEventListener("submit", onAgregarCorreo);
}

export async function prepararNotificaciones() {
  if (!esAdmin()) return;
  llenarSelectSedes(document.getElementById("nueva-notificacion-sede"), {
    incluirTodas: false,
    incluirAmbas: true,
  });
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

  // "ambas" no es una sede: es el atajo para no tener que agregar el mismo
  // correo una vez por sede. Se expande a las sedes que haya en la base.
  const eligioAmbas = fd.get("sede") === "ambas";
  const destinos = eligioAmbas ? getSedes().map((s) => s.id) : [fd.get("sede")];

  if (destinos.length === 0) {
    errorEl.textContent = "No se pudieron leer las sedes. Recarga la página.";
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Agregando...");

  // Una fila por sede, cada una en su propio insert. En un solo insert con
  // varias filas, Postgres ejecuta todo como una sentencia atómica: si el
  // correo ya existe en una sede, el choque con la restricción única
  // (sede_id, email) tumbaría también la inserción de la otra.
  const resultados = await Promise.all(
    destinos.map(async (sedeId) => {
      const { error } = await supabase
        .from("notificaciones_sede")
        .insert({ sede_id: sedeId, email });
      return { sedeId, error };
    })
  );

  setLoading(submitBtn, false);

  const agregadas = resultados.filter((r) => !r.error).map((r) => r.sedeId);
  const yaEstaban = resultados.filter((r) => r.error?.code === "23505").map((r) => r.sedeId);
  const fallaron = resultados.filter((r) => r.error && r.error.code !== "23505");

  // Un fallo real (permisos, red) sí es un error rojo, aunque otra sede haya entrado.
  if (fallaron.length > 0) {
    errorEl.textContent = "No se pudo agregar el correo.";
    errorEl.classList.remove("hidden");
    fallaron.forEach((r) => console.error(r.error));
    if (agregadas.length > 0) cargarNotificaciones();
    return;
  }

  // Nada que insertar porque ya estaba en todas: es un aviso, no un error.
  if (agregadas.length === 0) {
    if (eligioAmbas) {
      showToast("Ese correo ya estaba en todas las sedes.");
    } else {
      errorEl.textContent = "Ese correo ya está configurado para esta sede.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  form.reset();

  let mensaje;
  if (yaEstaban.length > 0) {
    mensaje = `Agregado a ${listarSedes(agregadas)} (ya estaba en ${listarSedes(yaEstaban)}).`;
  } else if (eligioAmbas) {
    mensaje = `Correo agregado a ${listarSedes(agregadas)}.`;
  } else {
    mensaje = "Correo agregado.";
  }
  showToast(mensaje);

  cargarNotificaciones();
}

// "Magdalena", "Magdalena y Jesús María", "A, B y C"
function listarSedes(ids) {
  const nombres = ids.map(nombreSede);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
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
