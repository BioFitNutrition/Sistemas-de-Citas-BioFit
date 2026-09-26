// ============================================
// Panel interno — se adapta al rol del usuario
// ============================================
// Admin y trabajador comparten la misma pantalla de Citas y Horarios; cambia el
// alcance de los datos y qué acciones se muestran. Un solo módulo evita duplicar
// la lógica, y RLS respalda todo desde la base.

import { supabase } from "./supabaseClient.js";
import { getPerfil, esAdmin, esTrabajador, misSedes } from "./auth.js";
import {
  showView, showToast, formatearFecha, formatearHora, hoyISO, escapeHtml, setLoading,
  hhmm12, toMin, rangoHora,
} from "./utils.js";
import { crearCalendarioMes, serieDeHoras } from "./calendario.js";
import { llenarSelectSedes, chipSede, nombreSede, getSedes } from "./sedes.js";
import { DURACION_CITA_MIN } from "./config.js";

let realtimeChannel = null;
let altaCal = null;      // calendario de alta de horarios (modo "varios")
let seleccionHorarios = new Set();   // ids marcados para borrar en lote (admin)
let diasAbiertos = new Set();        // "seccion|fecha" de los días desplegados
let citasALaVista = "activas";       // "activas" | "historial": sub-sección de Citas
let horariosALaVista = "libres";     // "libres" | "reservados" | "inhabilitados"
let tocoLosDias = false;             // true cuando el usuario abrió o cerró alguno

// Bloque propio del trabajador: qué sedes tiene, y una guía corta de cómo
// funciona su panel. Al admin no se le muestra: él ve y puede todo, y el propio
// panel de Usuarios ya le dice quién gestiona qué.
function pintarGuiaTrabajador(mias) {
  const bloque = document.getElementById("panel-trabajador");
  if (!bloque) return;

  bloque.classList.toggle("hidden", !esTrabajador());
  if (!esTrabajador()) return;

  const sedes = mias || [];
  const chips = document.getElementById("panel-sedes-chips");
  chips.innerHTML = "";
  sedes.forEach((id) => chips.appendChild(chipSede(id)));

  // Sin ninguna sede, el panel sale vacío; sin este aviso parece un error del
  // sistema y no una ficha a medio llenar.
  const sinSedes = sedes.length === 0;
  bloque.querySelector(".guia__sedes").classList.toggle("hidden", sinSedes);
  document.getElementById("panel-sin-sedes").classList.toggle("hidden", !sinSedes);
}

// Sedes que el usuario puede gestionar. `null` = todas, y es siempre el caso
// del admin. El trabajador tiene la lista exacta que le marcaron, que puede
// tener una, varias, o ninguna.
function misSedesGestionadas() {
  return esTrabajador() ? misSedes() : null;
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

  const mias = misSedesGestionadas();
  const cuantas = mias === null ? getSedes().length : mias.length;
  const unaSola = cuantas === 1;

  pintarGuiaTrabajador(mias);

  // CITAS: ahora SÍ se filtran por sede. Antes no, porque una cita delegada podía
  // ser de cualquier sede y el filtro se la escondía (el bug del punto 1 de
  // TAREAS.md). Sin delegación, sus citas son exactamente las de sus sedes, y RLS
  // ya no le entrega ninguna otra: el filtro solo ordena lo que igual puede ver.
  llenarSelectSedes(document.getElementById("filtro-sede-citas"), {
    incluirTodas: cuantas > 1,
    soloSedes: mias,
  });
  document
    .querySelector("#tab-citas .filter-row__sede")
    .classList.toggle("hidden", cuantas <= 1);

  // HORARIOS: mismo criterio.
  llenarSelectSedes(document.getElementById("filtro-sede-horarios"), {
    incluirTodas: cuantas > 1,
    soloSedes: mias,
  });
  llenarSelectSedes(document.getElementById("nuevo-horario-sede"), {
    incluirTodas: false,
    soloSedes: mias,
  });

  // Un selector de una sola opción no le sirve a nadie. Ojo: `.filter-row__sede`
  // también envuelve el selector del formulario de agregar horario, que es justo
  // el que el trabajador de varias sedes necesita para elegir dónde lo crea.
  document.querySelectorAll("#tab-horarios .filter-row__sede").forEach((el) => {
    el.classList.toggle("hidden", unaSola);
  });

  // Refresca el recuento del alta con la sede que corresponda al rol.
  actualizarResumenAlta();

  showView("view-panel");
  cambiarTab("citas");
  await Promise.all([cargarCitas(), cargarHorarios()]);
  activarRealtime();
}

export function salirDelPanel() {
  desactivarRealtime();
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

// ---------- CITAS ----------

export async function cargarCitas() {
  const listEl = document.getElementById("citas-list");
  listEl.innerHTML = '<p class="loading">Cargando citas...</p>';

  // El trabajador ve las citas de SU SEDE, sin filtro propio: su selector está
  // oculto y aquí se ignora a propósito. Quién ve qué lo decide RLS en la base.
  const filtro = esTrabajador()
    ? "todas"
    : document.getElementById("filtro-sede-citas").value;

  let query = supabase
    .from("citas")
    .select("id, nombre_cliente, telefono_cliente, email_cliente, sede_id, fecha, hora, estado")
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
      ? '<p class="empty-state">Todavía no hay citas en tus sedes.</p>'
      : '<p class="empty-state">No hay citas registradas.</p>';
    return;
  }

  // Dos secciones, para no confundir lo que hay que atender con lo que ya pasó.
  // "Activas" son las confirmadas de hoy en adelante; el resto es historial.
  const hoy = hoyISO();
  const activas = data.filter((c) => c.estado === "confirmada" && c.fecha >= hoy);
  const historial = data
    .filter((c) => !(c.estado === "confirmada" && c.fecha >= hoy))
    .reverse();   // el historial se lee al revés: lo más reciente primero

  // Las dos secciones se arman siempre, pero solo se muestra la elegida: con las
  // dos a la vez había que bajar toda la lista de próximas para llegar al
  // historial. El agrupado por día va dentro de cada una.
  const secciones = [
    renderSeccionCitas({
      clave: "activas",
      titulo: "Próximas",
      ayuda: "Confirmadas y todavía por atender, de hoy en adelante. Toca un día para abrirlo.",
      citas: activas,
      vacio: "No hay citas próximas.",
      abrirPrimero: true,
    }),
    renderSeccionCitas({
      clave: "historial",
      titulo: "Pasadas o canceladas",
      ayuda: "Ya no requieren acción: o se canceló, o la fecha quedó atrás.",
      citas: historial,
      vacio: "Ninguna por ahora.",
      // El historial arranca todo cerrado: es para consultar, no para atender.
      abrirPrimero: false,
    }),
  ];

  listEl.innerHTML = "";
  listEl.appendChild(renderSubtabs({
    activa: citasALaVista,
    opciones: [
      { clave: "activas", texto: "Próximas", cuantas: activas.length },
      { clave: "historial", texto: "Pasadas o canceladas", cuantas: historial.length },
    ],
    alElegir: (clave) => {
      citasALaVista = clave;
      mostrarSeccion(listEl, clave);
    },
  }));
  secciones.forEach((sec) => listEl.appendChild(sec));
  mostrarSeccion(listEl, citasALaVista);
}

// Barra de sub-pestañas, compartida por Citas y Horarios. Todas las secciones
// están en el DOM y esto solo elige cuál se ve: cambiar de pestaña no vuelve a
// consultar la base.
function renderSubtabs({ opciones, activa, alElegir }) {
  const barra = document.createElement("div");
  barra.className = "subtabs";
  barra.setAttribute("role", "tablist");

  opciones.forEach(({ clave, texto, cuantas }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab" + (clave === activa ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(clave === activa));

    const et = document.createElement("span");
    et.textContent = texto;
    btn.appendChild(et);

    const n = document.createElement("span");
    n.className = "subtab__cuenta";
    n.textContent = String(cuantas);
    btn.appendChild(n);

    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      barra.querySelectorAll(".subtab").forEach((b) => {
        const suya = b === btn;
        b.classList.toggle("active", suya);
        b.setAttribute("aria-selected", String(suya));
      });
      alElegir(clave);
    });

    barra.appendChild(btn);
  });

  return barra;
}

// Deja visible solo la sección `clave` dentro de esa lista.
function mostrarSeccion(lista, clave) {
  lista.querySelectorAll(".grupo").forEach((sec) => {
    sec.classList.toggle("hidden", !sec.classList.contains("grupo--" + clave));
  });
}

// Sin título ni contador propios: los pone la sub-pestaña de arriba, y
// repetirlos solo gastaba pantalla. Queda la línea de ayuda, que sí aporta.
function renderSeccionCitas({ clave, ayuda, citas, vacio, abrirPrimero }) {
  const seccion = document.createElement("section");
  seccion.className = "grupo grupo--" + clave;

  const nota = document.createElement("p");
  nota.className = "grupo__ayuda";
  nota.textContent = ayuda;
  seccion.appendChild(nota);

  if (citas.length === 0) {
    const vacia = document.createElement("p");
    vacia.className = "empty-state empty-state--chica";
    vacia.textContent = vacio;
    seccion.appendChild(vacia);
    return seccion;
  }

  // Agrupadas por día y desplegables, igual que los horarios. Con la lista plana
  // había que bajar mucho para encontrar el día que se buscaba.
  const porFecha = new Map();
  citas.forEach((c) => {
    if (!porFecha.has(c.fecha)) porFecha.set(c.fecha, []);
    porFecha.get(c.fecha).push(c);
  });

  let primero = abrirPrimero;
  porFecha.forEach((delDia, fecha) => {
    // Dentro del día, siempre de la hora más temprana a la más tarde — también
    // en el historial, donde el arreglo viene invertido para que los días bajen.
    delDia.sort((a, b) => a.hora.localeCompare(b.hora));
    seccion.appendChild(renderDiaCitas({ clave, fecha, delDia, primero }));
    primero = false;
  });

  return seccion;
}

// Un día de citas, desplegable. Cerrado ocupa una fila y ya dice lo esencial:
// qué día es, cuántas citas hay y cuántas de esas están canceladas.
function renderDiaCitas({ clave, fecha, delDia, primero }) {
  const det = document.createElement("details");
  det.className = "dia";

  // Se recuerda qué días dejó abiertos el usuario, para que un recargado (por
  // realtime, o al cancelar una cita) no se los cierre en la cara.
  const idDia = clave + "|" + fecha;
  det.open = tocoLosDias ? diasAbiertos.has(idDia) : Boolean(primero);
  if (det.open) diasAbiertos.add(idDia);

  det.addEventListener("toggle", () => {
    tocoLosDias = true;
    if (det.open) diasAbiertos.add(idDia);
    else diasAbiertos.delete(idDia);
  });

  const sum = document.createElement("summary");
  sum.className = "dia__sum";

  const texto = document.createElement("span");
  texto.className = "dia__fecha";
  texto.textContent = formatearFecha(fecha);
  sum.appendChild(texto);

  const cuantas = document.createElement("span");
  cuantas.className = "dia__cuenta";
  cuantas.textContent = plural(delDia.length, "cita", "citas");
  sum.appendChild(cuantas);

  const canceladas = delDia.filter((c) => c.estado === "cancelada").length;
  const franja = document.createElement("span");
  franja.className = "dia__franja";
  if (canceladas === delDia.length) {
    franja.textContent = "todas canceladas";
  } else if (canceladas > 0) {
    franja.textContent = canceladas + " cancelada" + (canceladas === 1 ? "" : "s");
  } else {
    const inicio = hhmm12(toMin(delDia[0].hora), true);
    const fin = hhmm12(toMin(delDia[delDia.length - 1].hora), true);
    franja.textContent = delDia.length === 1 ? inicio : inicio + " – " + fin;
  }
  sum.appendChild(franja);

  det.appendChild(sum);

  const cuerpo = document.createElement("div");
  cuerpo.className = "dia__cuerpo";
  delDia.forEach((cita) => cuerpo.appendChild(renderCita(cita)));
  det.appendChild(cuerpo);

  return det;
}

function renderCita(cita) {
  const row = document.createElement("div");
  row.className = "card-row";

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

  // Chip de sede con su color: el trabajador puede tener todas las sedes.
  const chips = document.createElement("div");
  chips.className = "card-row__chips";
  chips.appendChild(chipSede(cita.sede_id));
  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const badge = document.createElement("span");
  const cancelada = cita.estado === "cancelada";
  const pasada = !cancelada && cita.fecha < hoyISO();
  badge.className = `badge badge-${cancelada ? "cancelada" : pasada ? "ocupado" : "confirmada"}`;
  badge.textContent = cancelada ? "Cancelada" : pasada ? "Ya pasó" : "Confirmada";
  acciones.appendChild(badge);

  // Solo se cancela lo que todavía está por venir. Cancelar una cita pasada no
  // libera nada útil y solo ensucia el historial.
  if (!cancelada && !pasada) {
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

// El selector ya viene cargado solo con las sedes del usuario, así que alcanza
// con leerlo: aunque esté oculto por tener una sola opción, esa opción es la buena.
function sedeDelAlta() {
  return document.getElementById("nuevo-horario-sede").value;
}

// El calendario del panel NO se tiñe con el color de la sede: es una pantalla
// interna y va con el teal de la marca. El color por sede se queda donde sirve
// para orientar al socio (su calendario) y donde identifica la sede de un vistazo
// (los chips de las listas).
function alCambiarSedeAlta() {
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
    // ⚠️ "Todos los visibles" es literal: solo la sub-pestaña abierta. Sin el
    // `.grupo:not(.hidden)` también marcaría los de las secciones ocultas, y una
    // pulsada a Eliminar borraría horarios que el usuario nunca vio.
    document.querySelectorAll("#horarios-list .grupo:not(.hidden) .chk-horario:not(:disabled)").forEach((chk) => {
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

  // La casilla de arriba refleja el estado real de la sección a la vista.
  const libres = document.querySelectorAll("#horarios-list .grupo:not(.hidden) .chk-horario:not(:disabled)").length;
  if (todos) todos.checked = libres > 0 && n === libres;

  // Y cada día muestra si está entero, a medias o sin marcar.
  document.querySelectorAll("#horarios-list .grupo:not(.hidden) .dia").forEach((det) => {
    const chkDia = det.querySelector(".chk-dia");
    if (!chkDia) return;
    const casillas = [...det.querySelectorAll(".chk-horario:not(:disabled)")];
    const marcadas = casillas.filter((c) => c.checked).length;
    chkDia.checked = casillas.length > 0 && marcadas === casillas.length;
    chkDia.indeterminate = marcadas > 0 && marcadas < casillas.length;
  });
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

  // Sin ninguna sede asignada no hay nada que pedir, y un `.in("sede_id", [])`
  // se traduce a `in.()`, que PostgREST rechaza con un 400.
  const mias = misSedesGestionadas();
  if (Array.isArray(mias) && mias.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No tienes ninguna sede asignada.</p>';
    return;
  }

  const filtro = document.getElementById("filtro-sede-horarios").value;

  let query = supabase
    .from("horarios_disponibles")
    .select("id, sede_id, fecha, hora, disponible")
    .gte("fecha", hoyISO())          // fecha LOCAL, no UTC
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  if (filtro && filtro !== "todas") query = query.eq("sede_id", filtro);

  // ⚠️ Este recorte NO es cosmético. `horarios_disponibles` se lee en abierto
  // (el socio necesita ver los cupos), así que RLS no filtra nada aquí: si no se
  // acota a sus sedes, el trabajador vería y podría intentar tocar los de todas.
  if (mias) query = query.in("sede_id", mias);

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

  // ⚠⚠ REGLA QUE NO SE ROMPE: "ocupado" se deriva de `disponible`, NUNCA de
  // cruzar con `citas`. Lo de abajo NO decide si un horario está tomado — eso ya
  // lo dice `h.disponible`. Solo sirve para dos cosas secundarias:
  //   1. saber POR QUÉ no está disponible (cita confirmada vs deshabilitado a mano)
  //   2. saber cuáles no se pueden borrar: `citas.horario_id` es una FK sin ON
  //      DELETE, así que Postgres rechaza el borrado mientras la cita exista,
  //      INCLUSO si está cancelada (y una cancelada devuelve el horario a "Libre":
  //      ese es el caso traicionero).
  //
  // Desde el 25/09/2026 también lo hace el trabajador. Antes no podía: solo veía
  // las citas que le delegaban. Hoy ve las de sus sedes, y los horarios de esta
  // lista ya vienen recortados a esas mismas sedes, así que la foto le cuadra.
  // Y si alguna cita se le escapara, el horario cae en "Inhabilitados" en vez de
  // "Reservados": una etiqueta peor, nunca un horario que parezca libre sin serlo.
  let ocupados = new Set();
  let conCita = new Map();
  {
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

  // Tres sub-pestañas, y solo se ve una. "Reservado" e "inhabilitado" estaban
  // juntos y son cosas distintas: uno lo tomó un socio, al otro lo apagaste tú.
  const libres = horarios.filter((h) => h.disponible);
  const reservados = horarios.filter((h) => !h.disponible && ocupados.has(h.id));
  const inhabilitados = horarios.filter((h) => !h.disponible && !ocupados.has(h.id));

  listEl.innerHTML = "";
  listEl.appendChild(renderSubtabs({
    activa: horariosALaVista,
    opciones: [
      { clave: "libres", texto: "Libres", cuantas: libres.length },
      { clave: "reservados", texto: "Reservados", cuantas: reservados.length },
      { clave: "inhabilitados", texto: "Inhabilitados", cuantas: inhabilitados.length },
    ],
    alElegir: (clave) => {
      horariosALaVista = clave;
      mostrarSeccion(listEl, clave);
      // La selección NO cruza de sub-pestaña: si se quedara marcada, "eliminar"
      // borraría horarios que ya no están a la vista.
      seleccionHorarios.clear();
      listEl.querySelectorAll(".chk-horario").forEach((c) => { c.checked = false; });
      const todos = document.getElementById("chk-todos-horarios");
      if (todos) todos.checked = false;
      actualizarBarraLote();
    },
  }));

  listEl.appendChild(renderSeccionHorarios({
    clave: "libres",
    ayuda: "Creados y todavía disponibles para reservar.",
    horarios: libres,
    vacio: "No queda ningún horario libre. Crea más con el calendario de arriba.",
    ocupados, conCita,
  }));
  listEl.appendChild(renderSeccionHorarios({
    clave: "reservados",
    ayuda: "Un socio ya los tomó. No se pueden borrar mientras la cita exista.",
    horarios: reservados,
    vacio: "Ninguno reservado por ahora.",
    ocupados, conCita,
  }));
  listEl.appendChild(renderSeccionHorarios({
    clave: "inhabilitados",
    ayuda: "Apagados a mano: nadie puede reservarlos, pero no tienen cita.",
    horarios: inhabilitados,
    vacio: "Ninguno inhabilitado.",
    ocupados, conCita,
  }));

  mostrarSeccion(listEl, horariosALaVista);

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

// Una sección ("Libres" / "Reservados o deshabilitados") con sus días adentro.
// Sin título ni contador propios: los pone la sub-pestaña de arriba.
function renderSeccionHorarios({ clave, ayuda, horarios, vacio, ocupados, conCita }) {
  const seccion = document.createElement("section");
  seccion.className = "grupo grupo--" + clave;

  const nota = document.createElement("p");
  nota.className = "grupo__ayuda";
  nota.textContent = ayuda;
  seccion.appendChild(nota);

  if (horarios.length === 0) {
    const vacia = document.createElement("p");
    vacia.className = "empty-state empty-state--chica";
    vacia.textContent = vacio;
    seccion.appendChild(vacia);
    return seccion;
  }

  // Agrupar por fecha. La consulta ya viene ordenada por fecha y hora, así que
  // el orden de inserción del Map es el cronológico.
  const porFecha = new Map();
  horarios.forEach((hor) => {
    if (!porFecha.has(hor.fecha)) porFecha.set(hor.fecha, []);
    porFecha.get(hor.fecha).push(hor);
  });

  let primero = true;
  porFecha.forEach((delDia, fecha) => {
    seccion.appendChild(renderDia({ clave, fecha, delDia, ocupados, conCita, primero }));
    primero = false;
  });

  return seccion;
}

// Un día desplegable: una sola fila cuando está cerrado, en vez de una por hora.
function renderDia({ clave, fecha, delDia, ocupados, conCita, primero }) {
  const det = document.createElement("details");
  det.className = "dia";

  // Se recuerda qué días dejó abiertos el usuario para que recargar la lista
  // (al habilitar un horario, o por realtime) no se los cierre en la cara.
  const idDia = clave + "|" + fecha;
  det.open = tocoLosDias ? diasAbiertos.has(idDia) : primero;
  if (det.open) diasAbiertos.add(idDia);

  det.addEventListener("toggle", () => {
    tocoLosDias = true;
    if (det.open) diasAbiertos.add(idDia);
    else diasAbiertos.delete(idDia);
  });

  const sum = document.createElement("summary");
  sum.className = "dia__sum";

  // Casilla para marcar el día entero. Va dentro del summary, así que su clic
  // no debe llegar a abrir o cerrar el desplegable.
  if (esAdmin()) {
    const seleccionables = delDia.filter((hor) => !conCita.get(hor.id));
    if (seleccionables.length > 0) {
      const chkDia = document.createElement("input");
      chkDia.type = "checkbox";
      chkDia.className = "chk-dia";
      chkDia.title = "Marcar todos los de este día";
      chkDia.addEventListener("click", (e) => e.stopPropagation());
      chkDia.addEventListener("change", () => {
        seleccionables.forEach((hor) => {
          if (chkDia.checked) seleccionHorarios.add(hor.id);
          else seleccionHorarios.delete(hor.id);
        });
        det.querySelectorAll(".chk-horario:not(:disabled)").forEach((c) => {
          c.checked = chkDia.checked;
        });
        actualizarBarraLote();
      });
      sum.appendChild(chkDia);
    }
  }

  const texto = document.createElement("span");
  texto.className = "dia__fecha";
  texto.textContent = formatearFecha(fecha);
  sum.appendChild(texto);

  const cuantos = document.createElement("span");
  cuantos.className = "dia__cuenta";
  cuantos.textContent = plural(delDia.length, "horario", "horarios");
  sum.appendChild(cuantos);

  // Con el día cerrado, la franja que cubre es lo único que hace falta saber.
  const franja = document.createElement("span");
  franja.className = "dia__franja";
  const inicio = hhmm12(toMin(delDia[0].hora), true);
  const fin = hhmm12(toMin(delDia[delDia.length - 1].hora) + DURACION_CITA_MIN, true);
  franja.textContent = delDia.length === 1 ? inicio : inicio + " – " + fin;
  sum.appendChild(franja);

  det.appendChild(sum);

  const cuerpo = document.createElement("div");
  cuerpo.className = "dia__cuerpo";
  delDia.forEach((hor) => cuerpo.appendChild(renderHorario(hor, ocupados, conCita)));
  det.appendChild(cuerpo);

  return det;
}

function renderHorario(horario, ocupados, conCita) {
  const row = document.createElement("div");
  row.className = "card-row card-row--hora";

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

  // La fecha ya está en la cabecera del día: aquí basta la hora.
  const cuando = document.createElement("strong");
  cuando.textContent = rangoHora(horario.hora);
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
  // El trabajador únicamente puede tocar horarios libres de sus sedes.
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
  // Al cambiar de estado, el horario salta de sección. Sin aviso no se nota
  // adónde se fue.
  showToast(nuevoValor
    ? "Horario habilitado. Vuelve a «Libres»."
    : "Horario deshabilitado. Pasa a «Reservados o deshabilitados».");
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
