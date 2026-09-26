// ============================================
// Flujo del socio: sede → calendario → reserva → confirmación
// ============================================
// El socio NO inicia sesión. Reserva de forma anónima (rol anon de Supabase).
// RLS le permite leer sedes y horarios, e insertar citas; no puede leer citas.

import { supabase } from "./supabaseClient.js";
import { DURACION_CITA_MIN, NOMBRE_SERVICIO, ZONA_HORARIA } from "./config.js";
import {
  showView, isoLocal, hoyISO, parseISO, addDays, domingoDe,
  hoy0, capitalizar, formatearFecha, rangoHora, hhmm12, toMin,
  setLoading, emailValido, pintarVariablesSede,
} from "./utils.js";
import { crearCalendarioMes } from "./calendario.js";
import { getSedes, getSede, colorSede, mapaEmbedSede, mapsUrlSede } from "./sedes.js";

const state = {
  sedeId: null,
  horarioSeleccionado: null,   // { id, fecha, hora }
  disponibilidad: {},          // { 'YYYY-MM-DD': [ { id, fecha, hora }, ... ] }
  refDia: null,                // primer día visible en las columnas de horarios
  diaSel: null,                // 'YYYY-MM-DD' del día resaltado
  esNuevo: false,              // entró por "Soy nuevo": se le acompaña más
};

let resizeTimer = null;
let miniCal = null;            // componente de calendario (izquierda)

// Columnas de días visibles según el ancho de pantalla.
// En celular no entran 7: se muestran 3 y se avanza con las flechas. Nunca se
// deja que la franja desborde, porque haría scrollear la página entera de lado.
function columnasVisibles() {
  const w = window.innerWidth;
  if (w >= 980) return 7;
  if (w >= 680) return 4;
  return 3;
}

// ---------- init ----------

export function initClientFlow() {
  renderSedeGrid();

  document.getElementById("gcal-duracion").textContent = String(DURACION_CITA_MIN);
  document.getElementById("gcal-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("booking-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("conf-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("gcal-tz").textContent = ZONA_HORARIA;
  document.getElementById("booking-tz").textContent = ZONA_HORARIA;
  document.getElementById("conf-tz").textContent = ZONA_HORARIA;

  // Dos entradas al mismo flujo. La diferencia es el acompañamiento, no el
  // mecanismo: las dos terminan guardando la misma cita en la misma tabla.
  document.getElementById("btn-soy-cliente").addEventListener("click", () => {
    entrarAlFlujo(false);
  });

  document.getElementById("btn-soy-nuevo").addEventListener("click", () => {
    state.esNuevo = true;
    showView("view-bienvenida");
  });

  document.getElementById("btn-nuevo-elegir-sede").addEventListener("click", () => {
    entrarAlFlujo(true);
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showView("view-" + btn.dataset.back));
  });

  // El mini calendario es el mismo componente que usa el panel para cargar la
  // agenda; aquí va en modo "uno" y solo habilita los días que tienen cupo.
  miniCal = crearCalendarioMes(document.getElementById("mini-cal-host"), {
    modo: "uno",
    diaHabilitado: (iso) => Array.isArray(state.disponibilidad[iso]) && state.disponibilidad[iso].length > 0,
    onSeleccion: (iso) => saltarASemanaDe(iso),
  });

  document.getElementById("week-prev").addEventListener("click", () => cambiarSemana(-1));
  document.getElementById("week-next").addEventListener("click", () => cambiarSemana(1));

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wrap = document.getElementById("calendario-wrap");
      if (wrap && !wrap.classList.contains("hidden")) renderSemana();
    }, 150);
  });

  document.getElementById("form-cita").addEventListener("submit", onSubmitCita);
}

// Prepara la pantalla de sedes según por dónde entró la persona. Al socio de
// siempre se le va al grano; al nuevo se le explica dónde queda cada una.
function entrarAlFlujo(esNuevo) {
  state.esNuevo = esNuevo;

  document.getElementById("sede-titulo").textContent = esNuevo
    ? "¿Qué sede te queda más cerca?"
    : "Elige tu sede";
  document.getElementById("sede-ayuda").classList.toggle("hidden", !esNuevo);

  // El "Volver" del nuevo regresa a la bienvenida, no a la portada.
  const volver = document.getElementById("btn-volver-sede");
  volver.dataset.back = esNuevo ? "bienvenida" : "home";

  document.getElementById("booking-nuevo").classList.toggle("hidden", !esNuevo);
  document.getElementById("conf-nuevo").classList.toggle("hidden", !esNuevo);

  showView("view-sede");
}

// Las sedes vienen de la base, con su color.
function renderSedeGrid() {
  const grid = document.getElementById("sede-grid");
  grid.innerHTML = "";

  getSedes().forEach((sede) => {
    const btn = document.createElement("button");
    btn.className = "sede-card";
    btn.style.setProperty("--sede-color", sede.color || "");

    const nombre = document.createElement("span");
    nombre.className = "sede-card__nombre";
    nombre.textContent = sede.nombre;
    btn.appendChild(nombre);

    if (sede.direccion) {
      const dir = document.createElement("small");
      dir.className = "sede-card__dir";
      dir.textContent = sede.direccion;
      btn.appendChild(dir);
    }

    btn.addEventListener("click", () => seleccionarSede(sede.id));
    grid.appendChild(btn);
  });
}

async function seleccionarSede(sedeId) {
  state.sedeId = sedeId;
  const sede = getSede(sedeId) || {};
  document.getElementById("sede-nombre").textContent = sede.nombre || "";
  document.getElementById("sede-ciudad").textContent = sede.direccion || "";

  // Deja el color de la sede (y sus variantes legibles) en toda la vista: de
  // ahí lo toman el encabezado, el mini calendario y las píldoras de horario.
  pintarVariablesSede(document.getElementById("view-calendario"), colorSede(sedeId));
  if (miniCal) miniCal.setColor(colorSede(sedeId));

  renderMapaSede(sedeId);

  showView("view-calendario");
  await cargarDisponibilidad(sedeId);
}

// ---------- mini mapa de la sede ----------
// Dirección, mapa y botón salen de la base (`sedes`), nunca del código.
//
// Son DOS mecanismos distintos a propósito: el iframe usa el formato
// `output=embed`, que funciona sin API key pero no es una API documentada de
// Google; el botón "Cómo llegar" usa Maps URLs, que sí es oficial y tampoco
// necesita key. Si algún día el iframe deja de cargar, el botón sigue siendo
// la garantía de que el socio pueda llegar. No cambiar por la Embed API
// oficial: exige cuenta de facturación con tarjeta.

function renderMapaSede(sedeId) {
  const caja = document.getElementById("sede-mapa");
  const marco = document.getElementById("sede-mapa-frame-wrap");
  const iframe = document.getElementById("sede-mapa-frame");
  const link = document.getElementById("sede-mapa-link");

  // El nombre y la dirección NO se repiten aquí: ya están en el encabezado,
  // justo encima. Esta tarjeta es solo el "dónde queda".
  // Se limpia antes de pintar: si no, al cambiar de sede quedaría a la vista el
  // mapa de la anterior mientras el nuevo carga.
  iframe.removeAttribute("src");

  const embed = mapaEmbedSede(sedeId);
  marco.classList.toggle("hidden", !embed);
  if (embed) iframe.src = embed;

  const comoLlegar = mapsUrlSede(sedeId);
  link.classList.toggle("hidden", !comoLlegar);
  if (comoLlegar) link.href = comoLlegar;

  // Sin mapa ni enlace no hay tarjeta que mostrar.
  caja.classList.toggle("hidden", !(embed || comoLlegar));
}

// ---------- carga de disponibilidad ----------

async function cargarDisponibilidad(sedeId) {
  const loading = document.getElementById("calendario-loading");
  const empty = document.getElementById("calendario-empty");
  const wrap = document.getElementById("calendario-wrap");

  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  wrap.classList.add("hidden");

  const { data, error } = await supabase
    .from("horarios_disponibles")
    .select("id, fecha, hora")
    .eq("sede_id", sedeId)
    .eq("disponible", true)
    .gte("fecha", hoyISO())          // fecha LOCAL, no UTC
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  loading.classList.add("hidden");

  if (error) {
    empty.textContent = "No se pudieron cargar los horarios. Intenta de nuevo.";
    empty.classList.remove("hidden");
    console.error(error);
    return;
  }

  const porFecha = {};
  (data || []).forEach((h) => {
    (porFecha[h.fecha] = porFecha[h.fecha] || []).push(h);
  });
  state.disponibilidad = porFecha;

  const fechas = Object.keys(porFecha).sort();
  if (fechas.length === 0) {
    empty.textContent = "No hay horarios disponibles por ahora. Vuelve a intentarlo más tarde.";
    empty.classList.remove("hidden");
    return;
  }

  const primera = parseISO(fechas[0]);
  const hoy = hoy0();
  let ref = domingoDe(primera);
  if (ref < hoy) ref = hoy;
  state.refDia = ref;
  state.diaSel = null;

  wrap.classList.remove("hidden");

  // El calendario se entera de qué días tienen cupo AHORA (cambió la sede o se
  // recargó la disponibilidad) y se posiciona en el mes del primer día libre.
  miniCal.setDiaHabilitado((iso) => Array.isArray(state.disponibilidad[iso]) && state.disponibilidad[iso].length > 0);
  miniCal.irAlMes(fechas[0]);
  renderSemana();
}

// ---------- salto desde el mini calendario ----------

// Al elegir un día en el calendario, la franja salta a SU SEMANA con ese día
// marcado. En pantallas donde no entran los 7 días, la franja arranca en el día
// elegido, que es lo que el socio quiere ver.
function saltarASemanaDe(iso) {
  state.diaSel = iso || null;
  if (!iso) {
    renderSemana();
    return;
  }

  const dia = parseISO(iso);
  let ref = columnasVisibles() === 7 ? domingoDe(dia) : dia;
  const hoy = hoy0();
  if (ref < hoy) ref = hoy;    // la franja nunca muestra días pasados
  state.refDia = ref;
  renderSemana();
}

// ---------- columnas de horarios por día ----------

function cambiarSemana(dir) {
  if (!state.refDia) return;
  const paso = columnasVisibles();
  let nuevo = addDays(state.refDia, dir * paso);
  const hoy = hoy0();
  if (nuevo < hoy) nuevo = hoy;
  state.refDia = nuevo;
  renderSemana();
}

function renderSemana() {
  const grid = document.getElementById("week-grid");
  const btnPrev = document.getElementById("week-prev");

  const cols = columnasVisibles();
  grid.style.setProperty("--cols", cols);

  const dias = [];
  for (let i = 0; i < cols; i++) dias.push(addDays(state.refDia, i));

  btnPrev.disabled = state.refDia <= hoy0();

  const hoyIso = hoyISO();
  const slotsPorDia = dias.map((d) => {
    const iso = isoLocal(d);
    return (state.disponibilidad[iso] || []).slice().sort((a, b) => a.hora.localeCompare(b.hora));
  });
  const filas = Math.max(5, ...slotsPorDia.map((s) => s.length));

  grid.innerHTML = "";
  dias.forEach((d, idx) => {
    const iso = isoLocal(d);
    const col = document.createElement("div");
    col.className = "gcal__daycol";

    const head = document.createElement("div");
    head.className = "gcal__dayhd";
    const dow = document.createElement("span");
    dow.className = "dow";
    dow.textContent = d.toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "").toUpperCase();
    const num = document.createElement("span");
    // El día elegido en el mini calendario queda marcado aquí también, para que
    // se vea de un vistazo a qué día corresponden las píldoras.
    num.className = "num"
      + (iso === hoyIso ? " is-today" : "")
      + (iso === state.diaSel ? " is-selected" : "");
    num.textContent = String(d.getDate());
    head.appendChild(dow);
    head.appendChild(num);
    col.appendChild(head);

    const slots = slotsPorDia[idx];
    slots.forEach((horario) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "gcal__slot";
      pill.textContent = hhmm12(toMin(horario.hora), true);
      pill.addEventListener("click", () => seleccionarHorario(horario));
      col.appendChild(pill);
    });

    // Un día sin horarios no queda en blanco: lleva un guion por fila, para que
    // las columnas se lean parejas y se note que ahí no hay cupo.
    for (let i = 0; i < filas - slots.length; i++) {
      const dash = document.createElement("span");
      dash.className = "gcal__dash";
      dash.textContent = "—";
      col.appendChild(dash);
    }

    grid.appendChild(col);
  });
}

// ---------- reserva ----------

function seleccionarHorario(horario) {
  state.horarioSeleccionado = horario;
  const sede = getSede(state.sedeId) || {};

  document.getElementById("booking-when").textContent =
    `${formatearFecha(horario.fecha)} · ${rangoHora(horario.hora)}`;
  document.getElementById("booking-sede").textContent = sede.nombre || "";
  document.getElementById("booking-ciudad").textContent = sede.direccion || "";

  document.getElementById("form-cita").reset();
  document.getElementById("form-error").classList.add("hidden");
  showView("view-formulario");
}

async function onSubmitCita(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("form-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const nombreCompleto = `${fd.get("nombre").trim()} ${fd.get("apellidos").trim()}`.trim();
  const telefono = fd.get("telefono").trim();
  const email = fd.get("email").trim();

  // El correo ahora es obligatorio: el socio recibe su confirmación por ahí.
  if (!emailValido(email)) {
    errorEl.textContent = "Ingresa un correo electrónico válido; ahí te enviaremos la confirmación.";
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Reservando...");

  const horario = state.horarioSeleccionado;

  const { error } = await supabase.from("citas").insert({
    horario_id: horario.id,
    sede_id: state.sedeId,
    nombre_cliente: nombreCompleto,
    telefono_cliente: telefono,
    email_cliente: email,
    fecha: horario.fecha,
    hora: horario.hora,
  });

  setLoading(submitBtn, false);

  if (error) {
    console.error(error);
    if (error.message && error.message.includes("ya no está disponible")) {
      errorEl.textContent = "Uy, ese horario acaba de ser reservado por alguien más. Elige otro horario.";
      errorEl.classList.remove("hidden");
      await cargarDisponibilidad(state.sedeId);
      showView("view-calendario");
    } else {
      errorEl.textContent = "No se pudo confirmar la cita. Intenta de nuevo.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  mostrarConfirmacion(horario, email);
}

function mostrarConfirmacion(horario, email) {
  const sede = getSede(state.sedeId) || {};
  const fecha = parseISO(horario.fecha);

  document.getElementById("conf-day").textContent = String(fecha.getDate());
  document.getElementById("conf-mon").textContent =
    fecha.toLocaleDateString("es-PE", { month: "short" }).replace(".", "").toUpperCase();

  const diaSemana = capitalizar(fecha.toLocaleDateString("es-PE", { weekday: "long" }));
  document.getElementById("confirmacion-detalle").textContent =
    `${diaSemana} · ${rangoHora(horario.hora)}`;

  document.getElementById("conf-sede").textContent = sede.nombre || "";
  document.getElementById("conf-ciudad").textContent = sede.direccion || "";

  document.getElementById("confirmacion-email").textContent =
    `Te enviamos la confirmación a ${email}.`;

  showView("view-confirmacion");
}
