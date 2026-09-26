// ============================================
// El socio cancela su propia cita desde el correo
// ============================================
// Se entra por `?cancelar=<token>`. El token son 64 caracteres hex que viajan
// en el botón del correo de confirmación.
//
// ⚠️ NUNCA se usa el id de la cita para esto: los uuid no son secretos, y con el
// id cualquiera podría cancelar citas ajenas o barrerlas a mano.
//
// El anónimo NO puede leer ni editar `citas`. Todo pasa por dos funciones
// SECURITY DEFINER que solo aceptan el token:
//   cita_por_token(token)          -> datos mínimos + puede_cancelar + motivo
//   cancelar_cita_por_token(token) -> {ok:true} | {ok:false, motivo}
//
// El plazo (2 horas antes) lo decide la BASE, no esta pantalla: acá solo se
// muestra lo que ella responde. Si se validara aquí, bastaría con abrir la
// consola para saltárselo.

import { supabase } from "./supabaseClient.js";
import { showView, parseISO, capitalizar, rangoHora, setLoading } from "./utils.js";

let tokenActual = null;

export function tokenDeCancelacion() {
  const token = new URLSearchParams(window.location.search).get("cancelar");
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

// El token no puede quedarse en la barra de direcciones: se comparte al copiar
// el enlace, queda en el historial y se va en el Referer.
function limpiarUrlCancelacion() {
  const url = new URL(window.location.href);
  url.searchParams.delete("cancelar");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function mostrarBloque(id) {
  ["cancelar-cargando", "cancelar-aviso", "cancelar-detalle", "cancelar-listo"]
    .forEach((b) => document.getElementById(b).classList.toggle("hidden", b !== id));
}

function mostrarAviso(titulo, texto) {
  document.getElementById("cancelar-aviso-titulo").textContent = titulo;
  document.getElementById("cancelar-aviso-texto").textContent = texto;
  mostrarBloque("cancelar-aviso");
}

export async function abrirCancelacion(token) {
  tokenActual = token;
  showView("view-cancelar");
  mostrarBloque("cancelar-cargando");
  limpiarUrlCancelacion();

  const { data, error } = await supabase.rpc("cita_por_token", { p_token: token });

  if (error) {
    console.error(error);
    mostrarAviso("No pudimos abrir tu cita",
      "Hubo un problema de conexión. Vuelve a intentarlo en un momento.");
    return;
  }

  // Cero filas = enlace inválido o ya usado. La base no distingue entre los dos
  // a propósito: así el enlace no sirve para averiguar si una cita existe.
  const cita = Array.isArray(data) ? data[0] : data;
  if (!cita) {
    mostrarAviso("Este enlace ya no sirve",
      "Puede que la cita ya se haya cancelado, o que el enlace haya caducado. Si necesitas ayuda, escríbenos.");
    return;
  }

  if (!cita.puede_cancelar) {
    mostrarAviso("No se puede cancelar por aquí",
      cita.motivo || "Esta cita ya no se puede cancelar desde el enlace. Escríbenos y lo vemos.");
    return;
  }

  pintarCita(cita);
  mostrarBloque("cancelar-detalle");
}

function pintarCita(cita) {
  const fecha = parseISO(cita.fecha);

  document.getElementById("cancelar-saludo").textContent =
    `Hola ${cita.nombre_cliente}, esta es la cita que tienes reservada:`;

  document.getElementById("cancelar-day").textContent = fecha.getDate();
  document.getElementById("cancelar-mon").textContent =
    fecha.toLocaleDateString("es-PE", { month: "short" }).replace(".", "").toUpperCase();

  const diaSemana = capitalizar(
    fecha.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" }),
  );
  document.getElementById("cancelar-detalle-texto").textContent =
    `${diaSemana} · ${rangoHora(cita.hora)}`;

  document.getElementById("cancelar-sede").textContent = cita.sede_nombre || "";
  document.getElementById("cancelar-direccion").textContent = cita.sede_direccion || "";
}

async function confirmarCancelacion() {
  const btn = document.getElementById("cancelar-confirmar");
  const errorEl = document.getElementById("cancelar-error");
  errorEl.classList.add("hidden");
  setLoading(btn, true, "Cancelando...");

  const { data, error } = await supabase.rpc("cancelar_cita_por_token", { p_token: tokenActual });

  setLoading(btn, false);

  if (error) {
    console.error(error);
    errorEl.textContent = "No pudimos cancelarla. Revisa tu conexión y vuelve a intentarlo.";
    errorEl.classList.remove("hidden");
    return;
  }

  if (!data?.ok) {
    // Llegó tarde: se canceló desde el panel, o se pasó el plazo mientras la
    // pantalla estaba abierta. El motivo lo redacta la base.
    mostrarAviso("No se pudo cancelar", data?.motivo || "Este enlace ya no sirve.");
    return;
  }

  // El token ya quedó invalidado en la base; esta pantalla no sirve dos veces.
  tokenActual = null;
  mostrarBloque("cancelar-listo");
}

export function initCancelacion() {
  document.getElementById("cancelar-confirmar")
    .addEventListener("click", confirmarCancelacion);
}
