// ============================================
// Panel interno — se adapta al rol del usuario
// ============================================
// Admin y trabajador comparten la misma pantalla de Citas y Horarios; cambia el
// alcance de los datos y qué acciones se muestran. Un solo módulo evita duplicar
// la lógica, y RLS respalda todo desde la base.

import { supabase } from "./supabaseClient.js";
import { getPerfil, esAdmin, esTrabajador, miSede } from "./auth.js";
import {
  showView, showToast, formatearFecha, formatearHora, hoyISO, escapeHtml, setLoading,
} from "./utils.js";
import { llenarSelectSedes, chipSede, nombreSede } from "./sedes.js";

let realtimeChannel = null;
let trabajadores = [];   // cache para los selects de delegación (solo admin)

// ---------- arranque ----------

export function initPanel() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => cambiarTab(btn.dataset.tab));
  });

  document.getElementById("form-nuevo-horario").addEventListener("submit", onAgregarHorario);
  document.getElementById("filtro-sede-citas").addEventListener("change", cargarCitas);
  document.getElementById("filtro-sede-horarios").addEventListener("change", cargarHorarios);
}

// Entra al panel y lo configura según el rol.
export async function entrarAlPanel() {
  const perfil = getPerfil();
  if (!perfil) return;

  // Saludo y etiqueta de rol
  document.getElementById("panel-usuario").textContent = perfil.nombre || perfil.email;
  const badge = document.getElementById("panel-rol");
  badge.textContent = esAdmin() ? "Administrador" : "Trabajador";
  badge.classList.toggle("badge-admin", esAdmin());
  badge.classList.toggle("badge-trabajador", esTrabajador());

  // Secciones exclusivas del admin
  document.querySelectorAll("[data-solo-admin]").forEach((el) => {
    el.classList.toggle("hidden", !esAdmin());
  });

  // Filtros de sede: el admin ve todas; el trabajador queda fijo en la suya
  const opciones = esAdmin()
    ? { incluirTodas: true }
    : { incluirTodas: false, soloSede: miSede() };

  llenarSelectSedes(document.getElementById("filtro-sede-citas"), opciones);
  llenarSelectSedes(document.getElementById("filtro-sede-horarios"), opciones);
  llenarSelectSedes(document.getElementById("nuevo-horario-sede"), {
    incluirTodas: false,
    soloSede: esAdmin() ? null : miSede(),
  });

  // Al trabajador no le sirve un selector con una sola opción
  document.querySelectorAll(".filter-row__sede").forEach((el) => {
    el.classList.toggle("hidden", esTrabajador());
  });

  if (esAdmin()) await cargarTrabajadores();

  showView("view-panel");
  cambiarTab("citas");
  await Promise.all([cargarCitas(), cargarHorarios()]);
  activarRealtime();
}

export function salirDelPanel() {
  desactivarRealtime();
  trabajadores = [];
}

function cambiarTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  ["citas", "horarios", "usuarios", "notificaciones"].forEach((t) => {
    const panel = document.getElementById("tab-" + t);
    if (panel) panel.classList.toggle("hidden", t !== tab);
  });
}

// ---------- trabajadores (para delegar) ----------

async function cargarTrabajadores() {
  const { data, error } = await supabase
    .from("perfiles")
    .select("id, nombre, email, sede_id, activo")
    .eq("rol", "trabajador")
    .eq("activo", true)
    .order("nombre");

  if (error) {
    console.error("No se pudieron cargar los trabajadores:", error);
    trabajadores = [];
    return;
  }
  trabajadores = data || [];
}

export function getTrabajadores() {
  return trabajadores;
}

export async function refrescarTrabajadores() {
  if (esAdmin()) await cargarTrabajadores();
}

// ---------- CITAS ----------

export async function cargarCitas() {
  const listEl = document.getElementById("citas-list");
  listEl.innerHTML = '<p class="loading">Cargando citas...</p>';

  const filtro = document.getElementById("filtro-sede-citas").value;

  let query = supabase
    .from("citas")
    .select("id, nombre_cliente, telefono_cliente, email_cliente, sede_id, fecha, hora, estado, asignado_a")
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  if (filtro && filtro !== "todas") query = query.eq("sede_id", filtro);

  const { data, error } = await query;

  if (error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar las citas.</p>';
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = esTrabajador()
      ? '<p class="empty-state">Todavía no te han asignado ninguna cita.</p>'
      : '<p class="empty-state">No hay citas registradas.</p>';
    return;
  }

  listEl.innerHTML = "";
  data.forEach((cita) => listEl.appendChild(renderCita(cita)));
}

function renderCita(cita) {
  const row = document.createElement("div");
  row.className = "card-row";
  row.style.setProperty("--sede-color", "");

  const info = document.createElement("div");
  info.className = "info";

  const titulo = document.createElement("strong");
  titulo.textContent = cita.nombre_cliente;
  info.appendChild(titulo);

  const cuando = document.createElement("span");
  cuando.textContent = `${formatearFecha(cita.fecha)}, ${formatearHora(cita.hora)}`;
  info.appendChild(cuando);

  const contacto = document.createElement("span");
  contacto.textContent = cita.email_cliente
    ? `${cita.telefono_cliente} · ${cita.email_cliente}`
    : cita.telefono_cliente;
  info.appendChild(contacto);

  // Chip de sede con su color
  const chips = document.createElement("div");
  chips.className = "card-row__chips";
  chips.appendChild(chipSede(cita.sede_id));

  // A quién está asignada
  if (cita.asignado_a) {
    const t = trabajadores.find((t) => t.id === cita.asignado_a);
    const asign = document.createElement("span");
    asign.className = "chip-asignado";
    asign.textContent = esTrabajador()
      ? "Asignada a ti"
      : `→ ${t ? (t.nombre || t.email) : "trabajador"}`;
    chips.appendChild(asign);
  } else if (esAdmin()) {
    const sin = document.createElement("span");
    sin.className = "chip-asignado chip-asignado--vacio";
    sin.textContent = "Sin asignar";
    chips.appendChild(sin);
  }
  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const badge = document.createElement("span");
  const cancelada = cita.estado === "cancelada";
  badge.className = `badge badge-${cancelada ? "cancelada" : "confirmada"}`;
  badge.textContent = cancelada ? "Cancelada" : "Confirmada";
  acciones.appendChild(badge);

  // Solo el admin delega citas
  if (esAdmin() && !cancelada) {
    const select = document.createElement("select");
    select.className = "select-asignar";
    select.title = "Delegar esta cita a un trabajador";

    const vacio = document.createElement("option");
    vacio.value = "";
    vacio.textContent = "Sin asignar";
    select.appendChild(vacio);

    trabajadores.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.nombre || t.email;
      if (t.id === cita.asignado_a) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", () => asignarCita(cita.id, select.value || null));
    acciones.appendChild(select);
  }

  // Cancelar: el admin cualquiera; el trabajador solo las suyas (RLS lo respalda)
  if (!cancelada) {
    const btn = document.createElement("button");
    btn.className = "btn-small";
    btn.textContent = "Cancelar";
    btn.addEventListener("click", () => cancelarCita(cita.id));
    acciones.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

async function asignarCita(citaId, trabajadorId) {
  const { error } = await supabase
    .from("citas")
    .update({ asignado_a: trabajadorId })
    .eq("id", citaId);

  if (error) {
    showToast("No se pudo asignar la cita.", "error");
    console.error(error);
    return;
  }
  showToast(trabajadorId ? "Cita delegada. Se le avisará por correo." : "Cita sin asignar.");
  cargarCitas();
}

async function cancelarCita(id) {
  if (!window.confirm("¿Cancelar esta cita? El horario quedará disponible de nuevo.")) return;

  const { error } = await supabase.from("citas").update({ estado: "cancelada" }).eq("id", id);

  if (error) {
    showToast("No se pudo cancelar la cita.", "error");
    console.error(error);
    return;
  }
  showToast("Cita cancelada.");
  cargarCitas();
  cargarHorarios();
}

// ---------- HORARIOS ----------

async function onAgregarHorario(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("horario-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const sede = esAdmin() ? fd.get("sede") : miSede();

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Agregando...");

  const { error } = await supabase.from("horarios_disponibles").insert({
    sede_id: sede,
    fecha: fd.get("fecha"),
    hora: fd.get("hora"),
  });

  setLoading(submitBtn, false);

  if (error) {
    errorEl.textContent = error.code === "23505"
      ? "Ese horario ya existe para esta sede."
      : "No se pudo agregar el horario.";
    errorEl.classList.remove("hidden");
    console.error(error);
    return;
  }

  form.reset();
  showToast("Horario agregado.");
  cargarHorarios();
}

export async function cargarHorarios() {
  const listEl = document.getElementById("horarios-list");
  listEl.innerHTML = '<p class="loading">Cargando horarios...</p>';

  const filtro = document.getElementById("filtro-sede-horarios").value;

  let query = supabase
    .from("horarios_disponibles")
    .select("id, sede_id, fecha, hora, disponible")
    .gte("fecha", hoyISO())          // fecha LOCAL, no UTC
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  if (filtro && filtro !== "todas") query = query.eq("sede_id", filtro);
  if (esTrabajador()) query = query.eq("sede_id", miSede());

  const { data: horarios, error } = await query;

  if (error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar los horarios.</p>';
    console.error(error);
    return;
  }

  if (!horarios || horarios.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No hay horarios registrados. Agrega uno arriba.</p>';
    return;
  }

  // IMPORTANTE: el estado "ocupado" se deriva de `disponible`, NO de cruzar con `citas`.
  // Con RLS, un trabajador solo recibe SUS citas: si cruzáramos, los horarios tomados
  // por citas de otros le aparecerían libres y podría generarse una doble reserva.
  // Solo el admin (que ve todas las citas) puede distinguir "ocupado" de "deshabilitado".
  let ocupados = new Set();
  if (esAdmin()) {
    const { data: citas } = await supabase
      .from("citas")
      .select("horario_id")
      .eq("estado", "confirmada");
    ocupados = new Set((citas || []).map((c) => c.horario_id));
  }

  listEl.innerHTML = "";
  horarios.forEach((h) => listEl.appendChild(renderHorario(h, ocupados)));
}

function renderHorario(horario, ocupados) {
  const row = document.createElement("div");
  row.className = "card-row";

  const info = document.createElement("div");
  info.className = "info";

  const cuando = document.createElement("strong");
  cuando.textContent = `${formatearFecha(horario.fecha)}, ${formatearHora(horario.hora)}`;
  info.appendChild(cuando);

  const chips = document.createElement("div");
  chips.className = "card-row__chips";
  chips.appendChild(chipSede(horario.sede_id));
  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const badge = document.createElement("span");
  const tieneCita = ocupados.has(horario.id);

  let estado, etiqueta;
  if (horario.disponible) {
    estado = "libre";
    etiqueta = "Libre";
  } else if (esAdmin()) {
    estado = "ocupado";
    etiqueta = tieneCita ? "Ocupado" : "Deshabilitado";
  } else {
    // El trabajador no puede saber el motivo, y no lo necesita.
    estado = "ocupado";
    etiqueta = "No disponible";
  }
  badge.className = `badge badge-${estado}`;
  badge.textContent = etiqueta;
  acciones.appendChild(badge);

  // Solo se puede habilitar/deshabilitar un horario sin cita activa.
  // El trabajador únicamente puede tocar horarios libres de su sede.
  const puedeAlternar = esAdmin() ? !tieneCita : horario.disponible;

  if (puedeAlternar) {
    const btn = document.createElement("button");
    btn.className = "btn-small secondary";
    btn.textContent = horario.disponible ? "Deshabilitar" : "Habilitar";
    btn.addEventListener("click", () => alternarHorario(horario.id, !horario.disponible));
    acciones.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

async function alternarHorario(id, nuevoValor) {
  const { error } = await supabase
    .from("horarios_disponibles")
    .update({ disponible: nuevoValor })
    .eq("id", id);

  if (error) {
    showToast("No se pudo actualizar el horario.", "error");
    console.error(error);
    return;
  }
  cargarHorarios();
}

// ---------- Realtime ----------

function activarRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel("panel-citas")
    .on("postgres_changes", { event: "*", schema: "public", table: "citas" }, () => {
      cargarCitas();
      cargarHorarios();
    })
    .subscribe();
}

function desactivarRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
