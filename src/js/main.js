// ============================================
// Punto de entrada
// ============================================

import { showView, showToast, setLoading, initTogglesPassword } from "./utils.js";
import { cargarSedes } from "./sedes.js";
import { cargarPerfil, iniciarSesion, cerrarSesion, esAdmin } from "./auth.js";
import { initClientFlow } from "./client.js";
import { initPanel, entrarAlPanel, salirDelPanel } from "./panel.js";
import { initUsuarios, prepararUsuarios } from "./usuarios.js";
import { initNotificaciones, prepararNotificaciones } from "./notificaciones.js";
import { initCancelacion, tokenDeCancelacion, abrirCancelacion } from "./cancelar.js";

document.getElementById("year").textContent = new Date().getFullYear();

async function arrancar() {
  // Las sedes (nombre, dirección y color) vienen de la base y las necesitan
  // tanto el flujo público como el panel interno.
  await cargarSedes();

  initTogglesPassword();
  initClientFlow();
  initPanel();
  initUsuarios();
  initNotificaciones();
  initCancelacion();

  document.getElementById("btn-admin-login").addEventListener("click", () => {
    showView("view-admin-login");
  });

  document.getElementById("btn-topbar-back").addEventListener("click", () => {
    showView("view-home");
  });

  document.getElementById("form-login").addEventListener("submit", onLogin);
  document.getElementById("btn-logout").addEventListener("click", onLogout);

  // El enlace de cancelación manda: si el socio llegó por ahí, esa es la
  // pantalla, y no se sigue con el arranque normal. Va antes de cargarPerfil()
  // porque el socio no tiene sesión y no hay nada que esperar.
  const token = tokenDeCancelacion();
  if (token) {
    await abrirCancelacion(token);
    return;
  }

  // Si ya había sesión abierta (recargó la página estando dentro), entra directo.
  const perfil = await cargarPerfil();
  if (perfil) await abrirPanel();
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("hidden");

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Ingresando...");

  const fd = new FormData(form);
  const resultado = await iniciarSesion(fd.get("email"), fd.get("password"));

  setLoading(submitBtn, false);

  if (!resultado.ok) {
    errorEl.textContent = resultado.motivo === "sin_perfil"
      ? "Tu cuenta no tiene acceso al panel. Contacta al administrador."
      : "Credenciales incorrectas.";
    errorEl.classList.remove("hidden");
    return;
  }

  form.reset();
  await abrirPanel();
}

async function abrirPanel() {
  await entrarAlPanel();
  // Las secciones de usuarios y correos son exclusivas del administrador.
  if (esAdmin()) {
    await prepararUsuarios();
    await prepararNotificaciones();
  }
}

async function onLogout() {
  await cerrarSesion();
  salirDelPanel();
  showView("view-home");
  showToast("Sesión cerrada.");
}

arrancar().catch((err) => {
  console.error("Error al arrancar la aplicación:", err);
});
