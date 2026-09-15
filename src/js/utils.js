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

export function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
