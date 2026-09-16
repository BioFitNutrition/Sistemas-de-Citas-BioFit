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
  hhmm12, toMin,
} from "./utils.js";
import { crearCalendarioMes, serieDeHoras } from "./calendario.js";
import { llenarSelectSedes, chipSede, nombreSede, colorSede } from "./sedes.js";
import { DURACION_CITA_MIN } from "./config.js";

let realtimeChannel = null;
let trabajadores = [];   // cache para los selects de delegación (solo admin)
let altaCal = null;      // calendario de alta de horarios (modo "varios")
let seleccionHorarios = new Set();   // ids marcados para borrar en lote (admin)

// Sede a la que el usuario está amarrado, o null si puede elegir entre todas.
// El admin siempre puede. El trabajador solo si su perfil tiene sede_id NULL,
// que es la convención de la base para "cubre todas las sedes".
function sedeFija() {
  return esTrabajador() ? miSede() : null;
}

// ---------- arranque ----------

export function initPanel() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => cambiarTab(btn.dataset.tab));
  });

  document.getElementById("filtro-sede-citas").addEventListener("change", cargarCitas);
  document.getElementById("filtro-sede-horarios").addEventListener("change", cargarHorarios);

  initAltaHorarios();
  initBorradoEnLote();
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

  const miSedeFija = sedeFija();

  // CITAS: nunca se filtran por sede para el trabajador. Sus citas son las que
  // el admin le delegó, y pueden ser de CUALQUIER sede — su `sede_id` solo dice
  // qué horarios gestiona, no dónde puede atender. Filtrar aquí le escondía las
  // citas de la otra sede (el bug del punto 1 de TAREAS.md). RLS ya garantiza
  // que solo reciba las suyas: el filtro no protegía nada.
  llenarSelectSedes(document.getElementById("filtro-sede-citas"), { incluirTodas: true });
  document
    .querySelector("#tab-citas .filter-row__sede")
    .classList.toggle("hidden", esTrabajador());

  // HORARIOS: aquí el filtro por sede sí tiene sentido y se queda. Quien tiene
  // una sede fija queda amarrado a ella; el admin y el trabajador que cubre
  // todas pueden alternar entre las dos.
  const opcionesHorarios = miSedeFija
    ? { incluirTodas: false, soloSede: miSedeFija }
    : { incluirTodas: true };

  llenarSelectSedes(document.getElementById("filtro-sede-horarios"), opcionesHorarios);
  llenarSelectSedes(document.getElementById("nuevo-horario-sede"), {
    incluirTodas: false,
    soloSede: miSedeFija,
  });

  // Un selector de una sola opción no le sirve a nadie: se oculta únicamente a
  // quien tiene sede fija. Ojo: `.filter-row__sede` también envuelve el selector
  // del formulario de agregar horario, que es justo el que el trabajador de
  // ambas sedes necesita ver para elegir dónde crea el horario.
  document.querySelectorAll("#tab-horarios .filter-row__sede").forEach((el) => {
    el.classList.toggle("hidden", Boolean(miSedeFija));
  });

  // El calendario de alta toma el color de la sede activa (la elegida por el
  // admin, o la fija del trabajador).
  alCambiarSedeAlta();

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

  // El trabajador ve TODAS sus citas asignadas, sin importar la sede: su filtro
  // está oculto y aquí se ignora a propósito. RLS ya limita la lista a las suyas.
  const filtro = esTrabajador()
    ? "todas"
    : document.getElementById("filtro-sede-citas").value;

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

// ---------- ALTA DE HORARIOS (en lote) ----------
// Antes era un formulario de tres campos sueltos: una fila por horario. Cargar
// la agenda de una semana eran decenas de envios. Ahora se marcan varios dias
// en el calendario, se define una franja y se generan de una vez todas las
// citas de 20 minutos que entren.

const MINUTOS_OPCIONES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function initAltaHorarios() {
  const host = document.getElementById("alta-cal-host");
  if (!host) return;

  // El mismo componente que ve el socio, en modo "varios". `minimo: hoyISO()`
  // es lo que impide elegir fechas pasadas: no hace falta validarlo aparte.
  altaCal = crearCalendarioMes(host, {
    modo: "varios",
    minimo: hoyISO(),
    onSeleccion: actualizarResumenAlta,
  });

  llenarSelectHoras(document.getElementById("alta-desde-h"), document.getElementById("alta-desde-m"));
  llenarSelectHoras(document.getElementById("alta-hasta-h"), document.getElementById("alta-hasta-m"));

  // Franja por defecto: 5:00 pm a 7:00 pm.
  fijarHora("desde", 17, 0);
  fijarHora("hasta", 19, 0);

  document.querySelectorAll("#tab-horarios .hora-sel select").forEach((sel) => {
    sel.addEventListener("change", actualizarResumenAlta);
  });
  document.getElementById("nuevo-horario-sede").addEventListener("change", alCambiarSedeAlta);
  document.getElementById("btn-crear-horarios").addEventListener("click", onCrearHorarios);

  actualizarResumenAlta();
}

function llenarSelectHoras(selHora, selMin) {
  for (let h = 1; h <= 12; h++) {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = String(h);
    selHora.appendChild(o);
  }
  MINUTOS_OPCIONES.forEach((m) => {
    const o = document.createElement("option");
    o.value = String(m);
    o.textContent = String(m).padStart(2, "0");
    selMin.appendChild(o);
  });
}

function fijarHora(cual, hora24, minutos) {
  const h12 = hora24 % 12 === 0 ? 12 : hora24 % 12;
  document.getElementById("alta-" + cual + "-h").value = String(h12);
  document.getElementById("alta-" + cual + "-m").value = String(minutos);
  document.getElementById("alta-" + cual + "-ampm").value = hora24 >= 12 ? "PM" : "AM";
}

// Lee los tres selectores de una franja y devuelve minutos desde medianoche.
function leerHora(cual) {
  const h12 = Number(document.getElementById("alta-" + cual + "-h").value);
  const min = Number(document.getElementById("alta-" + cual + "-m").value);
  const pm = document.getElementById("alta-" + cual + "-ampm").value === "PM";

  let h24 = h12 % 12;            // 12am -> 0, 12pm -> 12
  if (pm) h24 += 12;
  return h24 * 60 + min;
}

function sedeDelAlta() {
  return sedeFija() ?? document.getElementById("nuevo-horario-sede").value;
}

function alCambiarSedeAlta() {
  if (altaCal) altaCal.setColor(colorSede(sedeDelAlta()));
  actualizarResumenAlta();
}

function plural(n, singular, pluralTxt) {
  return n + " " + (n === 1 ? singular : pluralTxt);
}

// Recalcula el aviso "Vas a crear N horarios en M dias" con cada cambio, y
// habilita el boton solo cuando hay algo valido que crear.
function actualizarResumenAlta() {
  const resumenEl = document.getElementById("alta-resumen");
  const btn = document.getElementById("btn-crear-horarios");
  if (!resumenEl || !btn) return;

  const dias = altaCal ? altaCal.seleccion() : [];
  const desde = leerHora("desde");
  const hasta = leerHora("hasta");
  const horas = serieDeHoras(desde, hasta, DURACION_CITA_MIN);

  let aviso = "";
  if (!sedeDelAlta()) aviso = "Elige la sede donde crear los horarios.";
  else if (dias.length === 0) aviso = "Marca al menos un día en el calendario.";
  else if (hasta <= desde) aviso = "La hora de fin tiene que ser posterior a la de inicio.";
  else if (horas.length === 0) aviso = "La franja es más corta que una cita de " + DURACION_CITA_MIN + " minutos.";

  resumenEl.classList.toggle("alta__resumen--aviso", Boolean(aviso));
  btn.disabled = Boolean(aviso);

  if (aviso) {
    resumenEl.textContent = aviso;
    return;
  }

  const total = dias.length * horas.length;
  const primera = hhmm12(toMin(horas[0]), true);
  const ultima = hhmm12(toMin(horas[horas.length - 1]) + DURACION_CITA_MIN, true);
  resumenEl.textContent =
    "Vas a crear " + plural(total, "horario", "horarios") +
    " en " + plural(dias.length, "día", "días") +
    " — de " + primera + " a " + ultima + ".";
}

// Cuenta cuántos de los horarios que se van a crear ya están en la base.
// Se consulta solo por las fechas elegidas, así que son pocas filas.
async function contarExistentes(sede, dias, horas) {
  const { data, error } = await supabase
    .from("horarios_disponibles")
    .select("fecha, hora")
    .eq("sede_id", sede)
    .in("fecha", dias);

  if (error) {
    console.error("No se pudo revisar qué horarios ya existían:", error);
    return 0;
  }

  const buscadas = new Set(horas);
  return (data || []).filter((h) => buscadas.has(String(h.hora).slice(0, 5))).length;
}

async function onCrearHorarios() {
  const errorEl = document.getElementById("horario-error");
  errorEl.classList.add("hidden");

  const dias = altaCal.seleccion();
  const horas = serieDeHoras(leerHora("desde"), leerHora("hasta"), DURACION_CITA_MIN);
  const sede = sedeDelAlta();
  if (dias.length === 0 || horas.length === 0 || !sede) return;

  const total = dias.length * horas.length;
  const confirmar = window.confirm(
    "Vas a crear " + plural(total, "horario", "horarios") +
    " en " + plural(dias.length, "día", "días") +
    " en " + nombreSede(sede) + ".\n\n¿Continuar?"
  );
  if (!confirmar) return;

  const filas = [];
  dias.forEach((fecha) => horas.forEach((hora) => filas.push({ sede_id: sede, fecha, hora })));

  const btn = document.getElementById("btn-crear-horarios");
  setLoading(btn, true, "Creando...");

  // Cuántos de los que se van a mandar YA existían. Se mide antes de insertar,
  // contra la base, en vez de deducirlo de lo que devuelva el driver: así el
  // recuento final es exacto pase lo que pase con la representación devuelta.
  const repetidos = await contarExistentes(sede, dias, horas);

  let error = null;

  // Se manda por tandas para no armar una sola petición enorme.
  for (let i = 0; i < filas.length && !error; i += 400) {
    const tanda = filas.slice(i, i + 400);

    // `ignoreDuplicates: true` se traduce en INSERT ... ON CONFLICT DO NOTHING:
    // los que ya existen se saltan en silencio y el resto se crea igual, en vez
    // de abortar toda la carga por chocar con unique(sede_id, fecha, hora).
    //
    // OJO: NO cambiar esto por un upsert normal. Pisaría la fila existente y
    // podría volver a marcar como disponible un horario ya reservado o
    // deshabilitado a mano, que es exactamente como se genera una doble reserva.
    const { error: err } = await supabase
      .from("horarios_disponibles")
      .upsert(tanda, { onConflict: "sede_id,fecha,hora", ignoreDuplicates: true });

    if (err) error = err;
  }

  setLoading(btn, false);

  if (error) {
    errorEl.textContent = "No se pudieron crear los horarios. Revisa tu conexión e intenta de nuevo.";
    errorEl.classList.remove("hidden");
    console.error(error);
    cargarHorarios();
    return;
  }

  const creados = Math.max(0, total - repetidos);
  showToast(
    repetidos > 0
      ? plural(creados, "creado", "creados") + ", " + plural(repetidos, "ya existía", "ya existían") + "."
      : plural(creados, "horario creado", "horarios creados") + "."
  );

  altaCal.limpiar();
  cargarHorarios();
}

// ---------- BORRADO EN LOTE (solo admin) ----------
// RLS solo deja borrar horarios al admin, asi que al trabajador no se le
// muestran ni las casillas ni el boton (la barra lleva data-solo-admin).

function initBorradoEnLote() {
  const todos = document.getElementById("chk-todos-horarios");
  const btn = document.getElementById("btn-borrar-horarios");
  if (!todos || !btn) return;

  todos.addEventListener("change", () => {
    // "Todos los visibles" son los que la lista muestra ahora, que ya respetan
    // el filtro de sede activo. Los bloqueados por una cita no se tocan.
    document.querySelectorAll("#horarios-list .chk-horario:not(:disabled)").forEach((chk) => {
      chk.checked = todos.checked;
      if (todos.checked) seleccionHorarios.add(chk.dataset.id);
      else seleccionHorarios.delete(chk.dataset.id);
    });
    actualizarBarraLote();
  });

  btn.addEventListener("click", onBorrarSeleccionados);
}

function actualizarBarraLote() {
  const btn = document.getElementById("btn-borrar-horarios");
  const todos = document.getElementById("chk-todos-horarios");
  if (!btn) return;

  const n = seleccionHorarios.size;
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? "Eliminar" : "Eliminar " + plural(n, "horario", "horarios");

  // La casilla de arriba refleja el estado real de la lista.
  const libres = document.querySelectorAll("#horarios-list .chk-horario:not(:disabled)").length;
  if (todos) todos.checked = libres > 0 && n === libres;
}

async function onBorrarSeleccionados() {
  const ids = [...seleccionHorarios];
  if (ids.length === 0) return;

  const confirmar = window.confirm(
    "¿Eliminar " + plural(ids.length, "horario", "horarios") + "?\n\nEsta acción no se puede deshacer."
  );
  if (!confirmar) return;

  const btn = document.getElementById("btn-borrar-horarios");
  setLoading(btn, true, "Eliminando...");

  const { error } = await supabase.from("horarios_disponibles").delete().in("id", ids);

  setLoading(btn, false);

  if (error) {
    // 23503 = hay una cita apuntando al horario. No deberia llegarse aca porque
    // esas casillas van deshabilitadas, pero pudo reservarse recien.
    showToast(
      error.code === "23503"
        ? "Alguno tiene una cita asociada y no se puede eliminar. Cancela la cita primero."
        : "No se pudieron eliminar los horarios.",
      "error"
    );
    console.error(error);
    cargarHorarios();
    return;
  }

  showToast(plural(ids.length, "horario eliminado", "horarios eliminados") + ".");
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

  // Solo se fuerza la sede si el trabajador tiene una. Si cubre todas, su
  // sede_id es NULL y un .eq("sede_id", null) rompería la consulta.
  const miSedeFija = sedeFija();
  if (miSedeFija) query = query.eq("sede_id", miSedeFija);

  const { data: horarios, error } = await query;

  if (error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar los horarios.</p>';
    console.error(error);
    return;
  }

  if (!horarios || horarios.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No hay horarios registrados. Crea los primeros con el calendario de arriba.</p>';
    apagarBarraLote();
    return;
  }

  // IMPORTANTE: el estado "ocupado" se deriva de `disponible`, NO de cruzar con `citas`.
  // Con RLS, un trabajador solo recibe SUS citas: si cruzáramos, los horarios tomados
  // por citas de otros le aparecerían libres y podría generarse una doble reserva.
  // Solo el admin (que ve todas las citas) puede distinguir "ocupado" de "deshabilitado".
  //
  // El admin necesita además saber qué horarios tiene ALGUNA cita apuntándolos,
  // incluso cancelada: `citas.horario_id` es una FK sin ON DELETE, así que
  // Postgres rechaza borrar el horario mientras esa fila exista. Ojo con el caso
  // traicionero: una cita cancelada libera el horario (vuelve a "Libre") pero
  // sigue bloqueando el borrado.
  let ocupados = new Set();
  let conCita = new Map();
  if (esAdmin()) {
    const { data: citas } = await supabase.from("citas").select("horario_id, estado");
    (citas || []).forEach((c) => {
      if (c.estado === "confirmada") {
        ocupados.add(c.horario_id);
        conCita.set(c.horario_id, "confirmada");
      } else if (!conCita.has(c.horario_id)) {
        conCita.set(c.horario_id, "cancelada");
      }
    });
  }

  // La selección no sobrevive a un recargado: los ids de la lista cambiaron.
  seleccionHorarios.clear();

  listEl.innerHTML = "";
  horarios.forEach((h) => listEl.appendChild(renderHorario(h, ocupados, conCita)));

  // La barra de borrado solo tiene sentido si el admin tiene algo que borrar.
  const barra = document.getElementById("lote-bar");
  if (barra) barra.classList.toggle("hidden", !esAdmin());
  const todos = document.getElementById("chk-todos-horarios");
  if (todos) todos.checked = false;
  actualizarBarraLote();
}

// Deja la barra de borrado en cero y fuera de vista: se usa cuando la lista
// queda sin filas, para que no quede un contador viejo colgado.
function apagarBarraLote() {
  seleccionHorarios.clear();
  const barra = document.getElementById("lote-bar");
  if (barra) barra.classList.add("hidden");
  const todos = document.getElementById("chk-todos-horarios");
  if (todos) todos.checked = false;
  actualizarBarraLote();
}

function renderHorario(horario, ocupados, conCita) {
  const row = document.createElement("div");
  row.className = "card-row";

  // Casilla de borrado en lote: solo admin (RLS no deja borrar al trabajador).
  // Si hay una cita apuntando al horario, la casilla va deshabilitada y explica
  // por qué: Postgres rechazaría el DELETE por la clave foránea.
  if (esAdmin()) {
    const motivo = conCita ? conCita.get(horario.id) : null;
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "chk-horario";
    chk.dataset.id = horario.id;
    if (motivo) {
      chk.disabled = true;
      chk.title = motivo === "confirmada"
        ? "Tiene una cita reservada. Cancela la cita para poder eliminarlo."
        : "Tiene una cita cancelada en el historial que lo referencia y no se puede eliminar.";
    } else {
      chk.addEventListener("change", () => {
        if (chk.checked) seleccionHorarios.add(horario.id);
        else seleccionHorarios.delete(horario.id);
        actualizarBarraLote();
      });
    }
    row.appendChild(chk);
  }

  const info = document.createElement("div");
  info.className = "info";

  const cuando = document.createElement("strong");
  cuando.textContent = `${formatearFecha(horario.fecha)}, ${formatearHora(horario.hora)}`;
  info.appendChild(cuando);

  const chips = document.createElement("div");
  chips.className = "card-row__chips";
  chips.appendChild(chipSede(horario.sede_id));

  // Para el admin, decir en la fila por qué un horario no se puede eliminar
  // evita que crea que la casilla está rota.
  const motivoFila = esAdmin() && conCita ? conCita.get(horario.id) : null;
  if (motivoFila) {
    const nota = document.createElement("span");
    nota.className = "chip-bloqueado";
    nota.textContent = motivoFila === "confirmada"
      ? "No se puede eliminar: tiene una cita"
      : "No se puede eliminar: cita cancelada en el historial";
    chips.appendChild(nota);
  }
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
