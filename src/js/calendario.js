// ============================================
// Calendario mensual reutilizable
// ============================================
// Un solo componente para las dos pantallas que necesitan un calendario:
//
//   · el socio eligiendo el día de su cita   → modo "uno"
//   · el panel cargando la agenda en lote    → modo "varios"
//
// Antes el del socio vivía incrustado en client.js, atado a ids fijos del HTML
// (#mini-grid, #mini-title...). Al necesitarse el mismo calendario en el panel
// se extrajo aquí: se monta sobre un contenedor vacío y se pinta solo, así que
// puede haber dos en la página sin que se pisen.
//
// Los colores salen de las variables que deja `pintarVariablesSede()`, nunca
// de un color escrito a mano: un color claro (el amarillo de Jesús María) se
// usa de fondo o de borde, y para texto se usa su variante oscurecida.

import {
  isoLocal, hoyISO, parseISO, addDays, primerDiaDelMes, domingoDe, capitalizar,
  pintarVariablesSede,
} from "./utils.js";
import { COLOR_SEDE_DEFECTO } from "./config.js";

const DOW_INICIALES = ["D", "L", "M", "X", "J", "V", "S"];

// Crea un calendario dentro de `host` y devuelve su API.
//
// Opciones:
//   modo          "uno" (un día) | "varios" (varios días, con arrastre)
//   color         color de la sede; manda el resaltado de los días
//   minimo        fecha ISO más temprana elegible (por defecto, hoy)
//   diaHabilitado (iso) => boolean — qué días se pueden elegir. Si no se pasa,
//                 se pueden todos los que no sean anteriores a `minimo`.
//   onSeleccion   se llama con el ISO (modo "uno") o el array de ISOs ordenado
//                 (modo "varios") cada vez que cambia la selección
export function crearCalendarioMes(host, opciones = {}) {
  const cfg = {
    modo: "uno",
    color: COLOR_SEDE_DEFECTO,
    minimo: hoyISO(),
    diaHabilitado: null,
    onSeleccion: () => {},
    ...opciones,
  };

  const varios = cfg.modo === "varios";
  let mesVisible = primerDiaDelMes(new Date());
  let seleccion = new Set();

  // Estado del arrastre (solo con mouse y solo en modo "varios"): al apretar
  // sobre un día se decide si el gesto marca o desmarca, y se mantiene ese
  // criterio mientras se pasa por encima de los demás.
  let arrastrando = false;
  let arrastreMarca = true;

  // ---------- estructura ----------
  // Se arma una sola vez; después solo se repinta la cuadrícula.

  host.innerHTML = "";
  host.classList.add("cal");
  if (varios) host.classList.add("cal--varios");

  const cabecera = document.createElement("div");
  cabecera.className = "cal__head";

  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "cal__nav";
  btnPrev.setAttribute("aria-label", "Mes anterior");
  btnPrev.textContent = "‹";

  const titulo = document.createElement("span");
  titulo.className = "cal__title";

  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "cal__nav";
  btnNext.setAttribute("aria-label", "Mes siguiente");
  btnNext.textContent = "›";

  cabecera.append(btnPrev, titulo, btnNext);

  const filaDow = document.createElement("div");
  filaDow.className = "cal__dow";
  DOW_INICIALES.forEach((d) => {
    const s = document.createElement("span");
    s.textContent = d;
    filaDow.appendChild(s);
  });

  const grid = document.createElement("div");
  grid.className = "cal__grid";

  host.append(cabecera, filaDow, grid);

  btnPrev.addEventListener("click", () => moverMes(-1));
  btnNext.addEventListener("click", () => moverMes(1));

  // ---------- reglas ----------

  function habilitado(iso) {
    if (iso < cfg.minimo) return false;
    return cfg.diaHabilitado ? Boolean(cfg.diaHabilitado(iso)) : true;
  }

  function avisar() {
    if (varios) cfg.onSeleccion(ordenada());
    else cfg.onSeleccion(seleccion.values().next().value ?? null);
  }

  function ordenada() {
    return [...seleccion].sort();
  }

  // ---------- interacción ----------

  function aplicar(iso, marcar) {
    if (!habilitado(iso)) return;
    if (varios) {
      if (marcar) seleccion.add(iso);
      else seleccion.delete(iso);
    } else {
      seleccion = new Set([iso]);
    }
  }

  function alApretar(e) {
    const btn = e.target.closest("button[data-iso]");
    if (!btn || btn.disabled) return;
    const iso = btn.dataset.iso;

    if (!varios) {
      aplicar(iso, true);
      render();
      avisar();
      return;
    }

    // En modo "varios" el clic alterna, y con mouse además arrastra.
    arrastreMarca = !seleccion.has(iso);
    aplicar(iso, arrastreMarca);
    if (e.pointerType === "mouse") arrastrando = true;
    render();
    avisar();
  }

  // Solo con mouse: al pasar por encima con el botón apretado se sigue
  // marcando (o desmarcando) en el mismo sentido que arrancó el gesto.
  // En pantallas táctiles el arrastre queda fuera a propósito: capturarlo
  // impediría desplazar la página con el dedo sobre el calendario.
  function alPasar(e) {
    if (!arrastrando) return;
    const btn = e.target.closest("button[data-iso]");
    if (!btn || btn.disabled) return;
    const iso = btn.dataset.iso;
    if (seleccion.has(iso) === arrastreMarca) return;   // ya está como toca
    aplicar(iso, arrastreMarca);
    render();
    avisar();
  }

  function alSoltar() {
    arrastrando = false;
  }

  grid.addEventListener("pointerdown", alApretar);
  if (varios) {
    grid.addEventListener("pointerover", alPasar);
    document.addEventListener("pointerup", alSoltar);
    document.addEventListener("pointercancel", alSoltar);
  }

  function moverMes(delta) {
    mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + delta, 1);
    render();
  }

  // ---------- pintado ----------

  function render() {
    pintarVariablesSede(host, cfg.color);

    titulo.textContent = capitalizar(
      mesVisible.toLocaleDateString("es-PE", { month: "long", year: "numeric" })
    );
    // No se puede retroceder más allá del mes del primer día elegible.
    btnPrev.disabled = mesVisible <= primerDiaDelMes(parseISO(cfg.minimo));

    const hoy = hoyISO();
    const inicio = domingoDe(primerDiaDelMes(mesVisible));

    grid.innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const fecha = addDays(inicio, i);
      const iso = isoLocal(fecha);                      // fecha LOCAL, no UTC

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal__day";
      btn.dataset.iso = iso;
      btn.textContent = String(fecha.getDate());

      if (fecha.getMonth() !== mesVisible.getMonth()) btn.classList.add("is-othermonth");
      if (iso === hoy) btn.classList.add("is-today");

      if (habilitado(iso)) {
        btn.classList.add("is-available");
        if (varios) btn.setAttribute("aria-pressed", String(seleccion.has(iso)));
      } else {
        btn.classList.add("is-off");
        btn.disabled = true;
      }

      if (seleccion.has(iso)) btn.classList.add("is-selected");

      grid.appendChild(btn);
    }
  }

  render();

  // ---------- API ----------

  return {
    render,
    // Días elegidos, siempre como array ordenado de ISOs.
    seleccion: () => ordenada(),
    limpiar() {
      seleccion = new Set();
      render();
      avisar();
    },
    // Marca un día y deja el calendario en el mes que lo contiene.
    seleccionar(iso) {
      if (!iso) return;
      aplicar(iso, true);
      mesVisible = primerDiaDelMes(parseISO(iso));
      render();
    },
    irAlMes(iso) {
      mesVisible = primerDiaDelMes(parseISO(iso));
      render();
    },
    setColor(color) {
      cfg.color = color || COLOR_SEDE_DEFECTO;
      render();
    },
    // Cambia la regla de qué días se pueden elegir y descarta los que dejaron
    // de valer (al cambiar de sede, los días con cupo son otros).
    setDiaHabilitado(fn) {
      cfg.diaHabilitado = fn;
      [...seleccion].forEach((iso) => {
        if (!habilitado(iso)) seleccion.delete(iso);
      });
      render();
    },
  };
}

// Genera la serie de horas de una franja, en pasos fijos.
// De 17:00 a 19:00 con paso 20 -> 17:00, 17:20, 17:40, 18:00, 18:20, 18:40.
// La última cita tiene que TERMINAR dentro de la franja: por eso la condición
// mira `inicio + paso <= fin` y no solo `inicio < fin`.
export function serieDeHoras(inicioMin, finMin, pasoMin) {
  const horas = [];
  if (!Number.isFinite(inicioMin) || !Number.isFinite(finMin) || pasoMin <= 0) return horas;
  for (let m = inicioMin; m + pasoMin <= finMin; m += pasoMin) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    horas.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return horas;
}
