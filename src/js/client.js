// ============================================
// Flujo del socio: sede → calendario → reserva → confirmación
// ============================================
// El socio NO inicia sesión. Reserva de forma anónima (rol anon de Supabase).
// RLS le permite leer sedes y horarios, e insertar citas; no puede leer citas.

import { supabase } from "./supabaseClient.js";
import { DURACION_CITA_MIN, NOMBRE_SERVICIO, ZONA_HORARIA } from "./config.js";
import {
  showView, isoLocal, hoyISO, parseISO, addDays, primerDiaDelMes, domingoDe,
  hoy0, capitalizar, formatearFecha, rangoHora, hhmm12, toMin,
  setLoading, emailValido,
} from "./utils.js";
import { getSedes, getSede, colorSede, mapaEmbedSede, mapsUrlSede } from "./sedes.js";

const state = {
  sedeId: null,
  horarioSeleccionado: null,   // { id, fecha, hora }
  disponibilidad: {},          // { 'YYYY-MM-DD': [ { id, fecha, hora }, ... ] }
  refDia: null,                // primer día visible en las columnas de horarios
  miniMes: null,               // mes mostrado en el mini calendario
  diaSel: null,                // 'YYYY-MM-DD' del día resaltado
};

let resizeTimer = null;

// Columnas de días visibles según el ancho de pantalla.
function columnasVisibles() {
  const w = window.innerWidth;
  if (w >= 980) return 7;
  if (w >= 680) return 4;
  return 1;
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

  document.getElementById("btn-soy-cliente").addEventListener("click", () => {
    showView("view-sede");
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showView("view-" + btn.dataset.back));
  });

  document.getElementById("mini-prev").addEventListener("click", () => cambiarMesMini(-1));
  document.getElementById("mini-next").addEventListener("click", () => cambiarMesMini(1));
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

  // Tiñe el encabezado del calendario con el color de la sede.
  const head = document.querySelector(".gcal-head");
  if (head) head.style.setProperty("--sede-color", colorSede(sedeId));

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
  const sede = getSede(sedeId) || {};

  // El filete lateral toma el color de la sede, igual que el encabezado.
  caja.style.setProperty("--sede-color", colorSede(sedeId));

  document.getElementById("sede-mapa-nombre").textContent = sede.nombre || "";
  document.getElementById("sede-mapa-dir").textContent = sede.direccion || "";

  // Se limpia antes de pintar: si no, al cambiar de sede quedaría a la vista el
  // mapa de la anterior mientras el nuevo carga.
  iframe.removeAttribute("src");

  const embed = mapaEmbedSede(sedeId);
  marco.classList.toggle("hidden", !embed);
  if (embed) iframe.src = embed;

  const comoLlegar = mapsUrlSede(sedeId);
  link.classList.toggle("hidden", !comoLlegar);
  if (comoLlegar) link.href = comoLlegar;

  // Si la sede no tuviera ni dirección ni mapa, la caja no aparece vacía.
  caja.classList.toggle("hidden", !(sede.direccion || embed || comoLlegar));
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
  state.miniMes = primerDiaDelMes(primera);
  state.diaSel = null;

  wrap.classList.remove("hidden");
  renderMiniCal();
  renderSemana();
}

// ---------- mini calendario ----------

function cambiarMesMini(delta) {
  if (!state.miniMes) return;
  state.miniMes = new Date(state.miniMes.getFullYear(), state.miniMes.getMonth() + delta, 1);
  renderMiniCal();
}

function renderMiniCal() {
  const grid = document.getElementById("mini-grid");
  const titulo = document.getElementById("mini-title");
  const btnPrev = document.getElementById("mini-prev");

  const mes = state.miniMes;
  titulo.textContent = capitalizar(
    mes.toLocaleDateString("es-PE", { month: "long", year: "numeric" })
  );
  btnPrev.disabled = mes <= primerDiaDelMes(new Date());

  const hoyIso = hoyISO();
  const inicio = domingoDe(primerDiaDelMes(mes));

  grid.innerHTML = "";
  for (let i = 0; i < 42; i++) {
    const fecha = addDays(inicio, i);
    const iso = isoLocal(fecha);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-cal__day";
    btn.textContent = String(fecha.getDate());

    if (fecha.getMonth() !== mes.getMonth()) btn.classList.add("is-othermonth");

    const disponible = Array.isArray(state.disponibilidad[iso]) && iso >= hoyIso;

    if (iso === hoyIso) btn.classList.add("is-today");
    if (disponible) {
      btn.classList.add("is-available");
      btn.addEventListener("click", () => seleccionarDia(iso));
    } else if (iso !== hoyIso) {
      btn.classList.add("is-off");
      btn.disabled = true;
    }
    if (iso === state.diaSel) btn.classList.add("is-selected");

    grid.appendChild(btn);
  }
}

function seleccionarDia(iso) {
  state.diaSel = iso;
  state.refDia = parseISO(iso);
  renderMiniCal();
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
    num.className = "num" + (iso === hoyIso ? " is-today" : "");
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
