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
import { getSedes, getSede, colorSede, mapaEmbedSede, mapsUrlSede, cargarSedes } from "./sedes.js";

const state = {
  sedeId: null,
  horarioSeleccionado: null,   // { id, fecha, hora }
  disponibilidad: {},          // { 'YYYY-MM-DD': [ { id, fecha, hora }, ... ] }
  refDia: null,                // primer día visible en las columnas de horarios
  diaSel: null,                // 'YYYY-MM-DD' del día resaltado
  sedesConAgenda: null,        // Set de sedes con horarios; null = todavía no se sabe
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
  pintarSedesDePortada();

  document.getElementById("gcal-duracion").textContent = String(DURACION_CITA_MIN);
  document.getElementById("gcal-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("booking-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("conf-servicio").textContent = NOMBRE_SERVICIO;
  document.getElementById("gcal-tz").textContent = ZONA_HORARIA;
  document.getElementById("booking-tz").textContent = ZONA_HORARIA;
  document.getElementById("conf-tz").textContent = ZONA_HORARIA;

  // Una sola entrada. Antes eran dos ("Soy socio" / "Soy nuevo") y la única
  // diferencia era cuánto se acompañaba a la persona; el socio de siempre se
  // saltaba los requisitos de la evaluación. Ahora los ve todo el mundo: quien
  // ya vino no pierde nada por releerlos, y quien los necesitaba ya no depende
  // de haber elegido bien el botón.
  document.getElementById("btn-agendar").addEventListener("click", () => {
    showView("view-bienvenida");
  });

  document.getElementById("btn-nuevo-elegir-sede").addEventListener("click", entrarAlFlujo);

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

  document.getElementById("proximamente-otra").addEventListener("click", () => showView("view-sede"));

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

  escucharSedes();
}

// Las sedes en vivo también para el socio: si Luis abre una sede (o le cambia la
// dirección o el mapa) mientras alguien tiene la página abierta, lo ve sin
// recargar. Es lectura anónima, que es justo lo que RLS le permite.
function escucharSedes() {
  supabase
    .channel("sedes-en-vivo")
    .on("postgres_changes", { event: "*", schema: "public", table: "sedes" }, async () => {
      await cargarSedes();
      renderSedeGrid();
      pintarSedesDePortada();
      // Si estaba mirando una sede, se repintan su nombre, dirección y mapa.
      // Ojo: NO se llama a seleccionarSede(), que cambia de vista y recarga los
      // horarios; el socio podría estar a mitad del formulario.
      if (state.sedeId) {
        const sede = getSede(state.sedeId) || {};
        document.getElementById("sede-nombre").textContent = sede.nombre || "";
        document.getElementById("sede-ciudad").textContent = sede.direccion || "";
        renderMapaSede(state.sedeId);
      }
    })
    // Y los horarios: en cuanto se carga el primero de una sede que estaba en
    // "Próximamente", su tarjeta se desbloquea sola, sin recargar la página.
    .on("postgres_changes", { event: "*", schema: "public", table: "horarios_disponibles" }, async () => {
      state.sedesConAgenda = await cargarSedesConAgenda();
      renderSedeGrid();
      // Si estaba viendo el calendario de esa sede, se repinta su
      // disponibilidad; si no, no hay nada que recargar.
      if (state.sedeId && !state.horarioSeleccionado) {
        await cargarDisponibilidad(state.sedeId);
      }
    })
    .subscribe();
}

// Prepara la pantalla de sedes. Todo el mundo entra por el mismo camino y ve
// las mismas indicaciones.
async function entrarAlFlujo() {
  showView("view-sede");

  // Se vuelve a preguntar en cada entrada, no una sola vez al arrancar: entre
  // que la persona abrió la página y llegó acá, pueden haberse cargado los
  // horarios de una sede que estaba en "Próximamente".
  state.sedesConAgenda = await cargarSedesConAgenda();
  renderSedeGrid();
}

// "Magdalena del Mar, Jesús María y Lince" — armado desde la base. La portada
// no puede nombrar sedes a mano: al abrir una nueva el texto quedaría mintiendo.
function pintarSedesDePortada() {
  const host = document.getElementById("hero-sedes");
  const nombres = getSedes().map((s) => s.nombre.replace(/^Sede\s+/i, ""));
  if (!host || nombres.length === 0) return;
  host.textContent = nombres.length === 1
    ? nombres[0]
    : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// Qué sedes ya tienen agenda abierta. Una sede anunciada pero sin NI UN horario
// cargado no deja entrar: se muestra como "Próximamente".
//
// Se mira si tiene algún horario, sin filtrar por fecha ni por disponibilidad.
// Así la sede se abre sola en cuanto alguien le carga el primero, sin tocar
// código y sin nombrar ninguna sede acá (que sería mentira al abrir la próxima).
//
// Si la consulta falla se devuelve null, que significa "no sabemos", y entonces
// NO se bloquea nada: es preferible dejar pasar y que el calendario avise, a
// cerrarle la puerta a un socio por un problema de red.
async function cargarSedesConAgenda() {
  const { data, error } = await supabase
    .from("horarios_disponibles")
    .select("sede_id");

  if (error) {
    console.error("No se pudo saber qué sedes tienen agenda:", error);
    return null;
  }
  return new Set((data || []).map((h) => h.sede_id));
}

function sedeAbierta(sedeId) {
  return state.sedesConAgenda === null || state.sedesConAgenda.has(sedeId);
}

// Las sedes vienen de la base, con su color.
function renderSedeGrid() {
  const grid = document.getElementById("sede-grid");
  grid.innerHTML = "";

  getSedes().forEach((sede) => {
    const abierta = sedeAbierta(sede.id);

    const btn = document.createElement("button");
    btn.className = abierta ? "sede-card" : "sede-card sede-card--pronto";
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

    if (abierta) {
      btn.addEventListener("click", () => seleccionarSede(sede.id));
    } else {
      // disabled de verdad, no solo apagada con CSS: así tampoco entra con Enter
      // ni con el tabulador.
      btn.disabled = true;

      const cinta = document.createElement("span");
      cinta.className = "sede-card__pronto";
      cinta.textContent = "Próximamente…";
      btn.appendChild(cinta);

      const pista = document.createElement("small");
      pista.className = "sede-card__pista";
      pista.textContent = "Ya casi… estamos terminando de armar los horarios.";
      btn.appendChild(pista);

      btn.setAttribute("aria-label",
        `${sede.nombre}. Próximamente: todavía no se puede reservar en esta sede.`);
    }

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
  const pronto = document.getElementById("calendario-proximamente");

  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  pronto.classList.add("hidden");
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
    // Sin cupos hay dos casos muy distintos: la sede que se quedó sin horas
    // libres, y la que todavía no abrió agenda. A la segunda no se le dice
    // "vuelve más tarde", se le anuncia. Se distinguen preguntando si la sede
    // tiene ALGÚN horario cargado, sin filtrar por fecha ni disponibilidad.
    const { count } = await supabase
      .from("horarios_disponibles")
      .select("id", { count: "exact", head: true })
      .eq("sede_id", sedeId);

    if (count === 0) {
      document.getElementById("proximamente-sede").textContent = getSede(sedeId)?.nombre || "Esta sede";
      pronto.classList.remove("hidden");
    } else {
      empty.textContent = "No hay horarios disponibles por ahora. Vuelve a intentarlo más tarde.";
      empty.classList.remove("hidden");
    }
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
    // La columna entera se resalta, no solo el número: en el celular se ven tres
    // columnas juntas y el circulito solo no alcanza para saber cuál es la tuya.
    col.className = "gcal__daycol" + (iso === state.diaSel ? " is-selected" : "");

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
  const dni = fd.get("dni").trim();

  // 8 dígitos exactos. La columna de la base es nullable a propósito (hay citas
  // viejas sin DNI); la obligatoriedad se exige acá, no en la tabla.
  if (!/^\d{8}$/.test(dni)) {
    errorEl.textContent = "El DNI debe tener exactamente 8 números, sin puntos ni guiones.";
    errorEl.classList.remove("hidden");
    return;
  }

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
    dni_cliente: dni,
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
