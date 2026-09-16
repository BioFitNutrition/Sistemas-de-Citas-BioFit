// ============================================
// Utilidades compartidas
// ============================================
// Aquí viven TODOS los helpers comunes. Antes estaban duplicados entre
// client.js y admin.js; ahora tienen un solo lugar.

import { DURACION_CITA_MIN } from "./config.js";

// ---------- Navegación entre vistas ----------

export function showView(viewId) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(viewId);
  if (target) target.classList.remove("hidden");

  // Deja constancia de la vista activa: el CSS ensancha #app en el calendario.
  const app = document.getElementById("app");
  if (app) app.dataset.view = viewId;

  // El botón "Volver" de la topbar solo aparece en la pantalla de login.
  const topbarBack = document.getElementById("btn-topbar-back");
  if (topbarBack) topbarBack.classList.toggle("hidden", viewId !== "view-admin-login");

  // Dentro del panel, "Team Enterprise" sobra: el usuario ya entró. Ahí arriba
  // solo tiene sentido "Cerrar sesión", que vive en la cabecera del panel.
  const topbarLogin = document.getElementById("btn-admin-login");
  if (topbarLogin) topbarLogin.classList.toggle("hidden", viewId === "view-panel");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Avisos tipo toast ----------

let toastTimer = null;
export function showToast(message, type = "ok") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden", "error");
  if (type === "error") toast.classList.add("error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ---------- Fechas ----------
// IMPORTANTE: siempre usar isoLocal() y NUNCA toISOString().slice(0,10).
// toISOString() devuelve la fecha en UTC: en Perú (GMT−5), después de las 7 pm
// daría "mañana" y los horarios de hoy desaparecerían de la lista.

export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hoyISO() {
  return isoLocal(new Date());
}

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function primerDiaDelMes(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function domingoDe(d) {
  return addDays(d, -d.getDay());
}

export function hoy0() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Formatea 'YYYY-MM-DD' a "Martes, 8 de setiembre"
export function formatearFecha(fechaISO) {
  const fecha = parseISO(fechaISO);
  const texto = fecha.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  // El locale ya devuelve "martes, 8 de setiembre"; solo capitalizamos la inicial.
  return capitalizar(texto);
}

// Formatea 'HH:MM:SS' a "HH:MM"
export function formatearHora(horaISO) {
  return horaISO.slice(0, 5);
}

// ---------- Horas en formato 12h ----------

export function toMin(horaISO) {
  const [h, m] = horaISO.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm12(mins, conSufijo) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const sufijo = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const base = `${h12}:${String(m).padStart(2, "0")}`;
  return conSufijo ? base + sufijo : base;
}

// "6:00 – 6:20pm" (sufijo am/pm solo al final, como Google Calendar)
export function rangoHora(horaISO) {
  const ini = toMin(horaISO);
  const fin = ini + DURACION_CITA_MIN;
  return `${hhmm12(ini, false)} – ${hhmm12(fin, true)}`;
}

// ---------- Varios ----------

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Activa/desactiva el estado de carga de un botón (spinner + deshabilitado).
export function setLoading(button, loading, loadingText) {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-loading");
    if (loadingText) button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

// ---------- Color: contraste y variantes legibles ----------
// El color de cada sede lo carga Luis en la base y puede ser cualquiera. El
// amarillo de Jesús María (#eab308) sobre blanco da ~1.9:1 de contraste: como
// TEXTO es ilegible. Por eso, en vez de confiar en que el color venga oscuro,
// aquí se derivan tres variantes y la interfaz usa la que corresponde:
//
//   colorSuave(c)     -> el color mezclado con blanco: sirve de FONDO
//   colorContraste(c) -> negro o blanco, para el texto que va ENCIMA del color
//   colorLegible(c)   -> el mismo color oscurecido hasta pasar 4.5:1 sobre
//                        blanco: la única variante que puede usarse como TEXTO
//
// Así un color claro nunca termina siendo texto sobre fondo blanco, sin tener
// que mantener una lista de excepciones por sede.

function canalLineal(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexARgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbAHex({ r, g, b }) {
  const dos = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${dos(r)}${dos(g)}${dos(b)}`;
}

// Luminancia relativa segun WCAG 2.1
export function luminanciaColor(hex) {
  const rgb = hexARgb(hex);
  if (!rgb) return 0;
  return 0.2126 * canalLineal(rgb.r) + 0.7152 * canalLineal(rgb.g) + 0.0722 * canalLineal(rgb.b);
}

// Razon de contraste entre dos colores (1 = iguales, 21 = negro sobre blanco).
export function contrasteColores(hexA, hexB) {
  const a = luminanciaColor(hexA);
  const b = luminanciaColor(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Texto que se puede poner ENCIMA de este color.
export function colorContraste(hex) {
  return contrasteColores(hex, "#0d0f0e") >= contrasteColores(hex, "#ffffff")
    ? "#0d0f0e"
    : "#ffffff";
}

// El color mezclado con blanco, para usarlo de fondo suave.
export function colorSuave(hex, proporcion = 0.14) {
  const rgb = hexARgb(hex);
  if (!rgb) return "#ffffff";
  return rgbAHex({
    r: 255 + (rgb.r - 255) * proporcion,
    g: 255 + (rgb.g - 255) * proporcion,
    b: 255 + (rgb.b - 255) * proporcion,
  });
}

// El color oscurecido lo justo para poder usarlo como TEXTO sobre blanco.
// Si ya pasa 4.5:1 se devuelve tal cual; si no, se van bajando los canales
// (lo que mantiene el tono) hasta que pase.
export function colorLegible(hex, minimo = 4.5) {
  const rgb = hexARgb(hex);
  if (!rgb) return "#0d0f0e";
  let actual = { ...rgb };
  for (let i = 0; i < 40; i++) {
    if (contrasteColores(rgbAHex(actual), "#ffffff") >= minimo) break;
    actual = { r: actual.r * 0.92, g: actual.g * 0.92, b: actual.b * 0.92 };
  }
  return rgbAHex(actual);
}

// Deja las variantes del color de una sede como variables CSS sobre un
// elemento, para que las hojas de estilo no tengan que saber nada de contraste.
export function pintarVariablesSede(el, color) {
  if (!el) return;
  el.style.setProperty("--sede-color", color);
  el.style.setProperty("--sede-suave", colorSuave(color));
  el.style.setProperty("--sede-borde", colorSuave(color, 0.55));
  el.style.setProperty("--sede-texto", colorLegible(color));
  el.style.setProperty("--sede-contraste", colorContraste(color));
}

// ---------- Ojito de las contraseñas ----------
// Cada campo de contraseña lleva al lado un botón [data-pwd-toggle] que alterna
// entre `password` y `text`. Se engancha una sola vez al arrancar, y sirve para
// todos los campos que existan en el HTML (login y alta de trabajadores).

export function initTogglesPassword() {
  document.querySelectorAll("[data-pwd-toggle]").forEach((btn) => {
    const input = btn.parentElement?.querySelector("input");
    if (!input) return;

    btn.addEventListener("click", () => {
      const estabaVisible = input.type === "text";
      input.type = estabaVisible ? "password" : "text";
      btn.classList.toggle("is-on", !estabaVisible);
      btn.setAttribute("aria-pressed", String(!estabaVisible));
      btn.setAttribute("aria-label", estabaVisible ? "Mostrar contraseña" : "Ocultar contraseña");
    });
  });
}

export function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
