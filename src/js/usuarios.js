// ============================================
// Gestión de usuarios — SOLO ADMIN
// ============================================
// Crear un usuario en Supabase Auth requiere la service_role key, que NUNCA
// puede estar en el frontend (el repositorio es público). Por eso la creación
// pasa por la Edge Function `crear-usuario`, que valida que quien llama sea
// admin y usa la service_role del lado del servidor.
//
// Las sedes del trabajador viven en `perfil_sedes`, una fila por sede. Es un
// conjunto explícito: no existe un "todas" que se estire solo cuando abra una
// sede nueva. Si abre una, nadie la gestiona hasta que el admin la marque.

import { supabase } from "./supabaseClient.js";
import { SUPABASE_URL } from "./config.js";
import { esAdmin } from "./auth.js";
import { showToast, setLoading } from "./utils.js";
import { nombreSede, getSedes, chipSede } from "./sedes.js";
import { cargarCitas } from "./panel.js";
import { cargarNotificaciones } from "./notificaciones.js";

// Sedes de cada trabajador, tal como están en la base. Es la foto contra la que
// se calcula qué agregar y qué quitar al guardar.
let _sedesPorUsuario = new Map();
let _editando = null;

export function initUsuarios() {
  const form = document.getElementById("form-nuevo-usuario");
  if (form) form.addEventListener("submit", onCrearUsuario);

  document.getElementById("btn-editor-volver")?.addEventListener("click", cerrarEditor);
  document.getElementById("btn-editor-cancelar")?.addEventListener("click", cerrarEditor);
  document.getElementById("btn-editor-guardar")?.addEventListener("click", guardarEditor);
}

export async function prepararUsuarios() {
  if (!esAdmin()) return;
  pintarChecksSedes(document.getElementById("nuevo-usuario-sedes"), []);
  cerrarEditor();
  await cargarUsuarios();
}

// ---------- checks de sedes, compartidos por el alta y el editor ----------

function pintarChecksSedes(host, marcadas, alCambiar = null) {
  if (!host) return;
  host.innerHTML = "";

  getSedes().forEach((sede) => {
    const fila = document.createElement("label");
    fila.className = "check-row";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.value = sede.id;
    chk.checked = marcadas.includes(sede.id);
    if (alCambiar) chk.addEventListener("change", alCambiar);

    const texto = document.createElement("span");
    texto.textContent = sede.nombre;

    fila.append(chk, texto);
    host.appendChild(fila);
  });
}

function sedesMarcadas(host) {
  return [...host.querySelectorAll('input[type="checkbox"]')]
    .filter((c) => c.checked)
    .map((c) => c.value);
}

function listarNombres(ids) {
  const nombres = ids.map(nombreSede);
  if (nombres.length === 0) return "ninguna sede";
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// ---------- lista ----------

export async function cargarUsuarios() {
  const listEl = document.getElementById("usuarios-list");
  if (!listEl) return;
  listEl.innerHTML = '<p class="loading">Cargando usuarios...</p>';

  const [perfiles, asignaciones] = await Promise.all([
    supabase
      .from("perfiles")
      .select("id, email, nombre, rol, activo, created_at")
      .order("rol")
      .order("nombre"),
    supabase.from("perfil_sedes").select("perfil_id, sede_id"),
  ]);

  if (perfiles.error || asignaciones.error) {
    listEl.innerHTML = '<p class="empty-state">No se pudieron cargar los usuarios.</p>';
    console.error(perfiles.error || asignaciones.error);
    return;
  }

  _sedesPorUsuario = new Map();
  (asignaciones.data || []).forEach(({ perfil_id, sede_id }) => {
    if (!_sedesPorUsuario.has(perfil_id)) _sedesPorUsuario.set(perfil_id, []);
    _sedesPorUsuario.get(perfil_id).push(sede_id);
  });

  listEl.innerHTML = "";
  (perfiles.data || []).forEach((u) => listEl.appendChild(renderUsuario(u)));
}

function sedesDe(u) {
  return _sedesPorUsuario.get(u.id) ?? [];
}

function renderUsuario(u) {
  const row = document.createElement("div");
  row.className = "card-row";

  const info = document.createElement("div");
  info.className = "info";

  const nombre = document.createElement("strong");
  nombre.textContent = u.nombre || u.email;
  info.appendChild(nombre);

  const correo = document.createElement("span");
  correo.textContent = u.email;
  info.appendChild(correo);

  const chips = document.createElement("div");
  chips.className = "card-row__chips";

  const rol = document.createElement("span");
  rol.className = `badge badge-${u.rol === "admin" ? "admin" : "trabajador"}`;
  rol.textContent = u.rol === "admin" ? "Administrador" : "Trabajador";
  chips.appendChild(rol);

  // En el admin no se muestran sedes: por definición ve y recibe todo, y sus
  // permisos no salen de `perfil_sedes` sino de `es_admin()`.
  if (u.rol !== "admin") {
    const suyas = sedesDe(u);
    if (suyas.length === 0) {
      const ninguna = document.createElement("span");
      ninguna.className = "badge badge-ocupado";
      ninguna.textContent = "Sin sedes";
      chips.appendChild(ninguna);
    } else {
      suyas.forEach((id) => chips.appendChild(chipSede(id)));
    }
  }

  info.appendChild(chips);

  const acciones = document.createElement("div");
  acciones.className = "card-row__acciones";

  const estado = document.createElement("span");
  estado.className = `badge badge-${u.activo ? "libre" : "ocupado"}`;
  estado.textContent = u.activo ? "Activo" : "Inactivo";
  acciones.appendChild(estado);

  // El admin no se edita desde aquí: no tiene sedes que repartir y desactivarlo
  // lo dejaría a él mismo fuera del sistema.
  if (u.rol !== "admin") {
    const btn = document.createElement("button");
    btn.className = "btn-small secondary";
    btn.textContent = "Editar";
    btn.addEventListener("click", () => abrirEditor(u));
    acciones.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(acciones);
  return row;
}

// ---------- vista de editar ----------

function abrirEditor(u) {
  _editando = u;

  document.getElementById("editor-nombre").textContent = u.nombre || u.email;
  document.getElementById("editor-email").textContent = u.email;
  document.getElementById("editor-error").classList.add("hidden");

  pintarChecksSedes(document.getElementById("editor-sedes"), sedesDe(u), refrescarResumenEditor);

  document.querySelectorAll('input[name="editor-estado"]').forEach((r) => {
    r.checked = r.value === (u.activo ? "activo" : "inactivo");
    r.onchange = refrescarResumenEditor;
  });

  refrescarResumenEditor();

  document.getElementById("usuarios-main").classList.add("hidden");
  document.getElementById("usuario-editor").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cerrarEditor() {
  _editando = null;
  document.getElementById("usuario-editor")?.classList.add("hidden");
  document.getElementById("usuarios-main")?.classList.remove("hidden");
}

function estadoDelEditor() {
  return document.querySelector('input[name="editor-estado"]:checked')?.value === "activo";
}

// El resumen dice en texto llano qué va a pasar cuando guarde. Es la única
// manera de que se note que las sedes también mueven los correos de aviso.
function refrescarResumenEditor() {
  const marcadas = sedesMarcadas(document.getElementById("editor-sedes"));
  const activo = estadoDelEditor();

  document
    .getElementById("editor-sedes-aviso")
    .classList.toggle("hidden", marcadas.length > 0);

  const resumen = document.getElementById("editor-avisos");
  if (!activo) {
    resumen.textContent = "Inactivo: no podrá entrar al panel ni recibirá avisos.";
  } else if (marcadas.length === 0) {
    resumen.textContent = "Podrá entrar, pero no verá ninguna cita ni horario.";
  } else {
    resumen.textContent =
      `Verá las citas y los horarios de ${listarNombres(marcadas)}, ` +
      `y recibirá por correo los avisos de ${marcadas.length === 1 ? "esa sede" : "esas sedes"}.`;
  }
}

async function guardarEditor() {
  const u = _editando;
  if (!u) return;

  const btn = document.getElementById("btn-editor-guardar");
  const errorEl = document.getElementById("editor-error");
  errorEl.classList.add("hidden");

  const nuevas = sedesMarcadas(document.getElementById("editor-sedes"));
  const activo = estadoDelEditor();
  const previas = sedesDe(u);

  const agregar = nuevas.filter((id) => !previas.includes(id));
  const quitar = previas.filter((id) => !nuevas.includes(id));
  const cambioEstado = activo !== u.activo;

  if (agregar.length === 0 && quitar.length === 0 && !cambioEstado) {
    showToast("No había nada que cambiar.");
    cerrarEditor();
    return;
  }

  setLoading(btn, true, "Guardando...");

  try {
    if (quitar.length > 0) {
      const { error } = await supabase
        .from("perfil_sedes")
        .delete()
        .eq("perfil_id", u.id)
        .in("sede_id", quitar);
      if (error) throw error;
    }

    if (agregar.length > 0) {
      const { error } = await supabase
        .from("perfil_sedes")
        .insert(agregar.map((sede_id) => ({ perfil_id: u.id, sede_id })));
      if (error) throw error;
    }

    if (cambioEstado) {
      const { error } = await supabase.from("perfiles").update({ activo }).eq("id", u.id);
      if (error) throw error;
    }

    const correos = await sincronizarCorreos(u.email, nuevas, activo);

    showToast(correos.ok
      ? `Guardado. ${activo ? `Gestiona ${listarNombres(nuevas)}.` : "Queda inactivo."}`
      : "Guardado, pero no se pudieron ajustar sus correos de aviso.");

    cerrarEditor();
    await cargarUsuarios();
    await cargarNotificaciones();
    await cargarCitas();
  } catch (err) {
    console.error(err);
    errorEl.textContent = "No se pudo guardar. Revisa la conexión e inténtalo otra vez.";
    errorEl.classList.remove("hidden");
  } finally {
    setLoading(btn, false);
  }
}

// ---------- correos de aviso atados a las sedes del trabajador ----------
// Regla: un trabajador ACTIVO recibe los avisos de las sedes que gestiona. Uno
// inactivo no recibe ninguno. Esta función deja `notificaciones_sede` exactamente
// así para ese correo, sin tocar los correos de nadie más (el Gmail de BioFit,
// el personal de Luis, etc.).

export async function sincronizarCorreos(email, sedeIds, activo) {
  const objetivo = new Set(activo ? sedeIds : []);

  const { data: actuales, error } = await supabase
    .from("notificaciones_sede")
    .select("id, sede_id")
    .eq("email", email);

  if (error) {
    console.error("No se pudieron leer los correos del usuario:", error);
    return { ok: false };
  }

  const yaTiene = new Set((actuales || []).map((r) => r.sede_id));
  const sobran = (actuales || []).filter((r) => !objetivo.has(r.sede_id));
  const faltan = [...objetivo].filter((id) => !yaTiene.has(id));

  if (sobran.length > 0) {
    const { error: errBorrar } = await supabase
      .from("notificaciones_sede")
      .delete()
      .in("id", sobran.map((r) => r.id));
    if (errBorrar) {
      console.error("No se pudieron quitar los correos que sobraban:", errBorrar);
      return { ok: false };
    }
  }

  // Uno por uno: en un insert de varias filas, un choque con la restricción
  // única (sede_id, email) tumbaría también las demás.
  for (const sede of faltan) {
    const { error: errAlta } = await supabase
      .from("notificaciones_sede")
      .insert({ sede_id: sede, email });
    // 23505 = ya estaba. No es un fallo: es justo el estado que queríamos.
    if (errAlta && errAlta.code !== "23505") {
      console.error("No se pudo agregar el correo del usuario:", errAlta);
      return { ok: false };
    }
  }

  return { ok: true, agregadas: faltan, quitadas: sobran.map((r) => r.sede_id) };
}

// ---------- alta ----------

async function onCrearUsuario(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("usuario-error");
  errorEl.classList.add("hidden");

  const fd = new FormData(form);
  const sedes = sedesMarcadas(document.getElementById("nuevo-usuario-sedes"));
  const password = fd.get("password");

  if (password.length < 8) {
    errorEl.textContent = "La contraseña debe tener al menos 8 caracteres.";
    errorEl.classList.remove("hidden");
    return;
  }

  if (sedes.length === 0) {
    errorEl.textContent = "Marca al menos una sede: sin ninguna no vería citas ni horarios.";
    errorEl.classList.remove("hidden");
    return;
  }

  const payload = {
    email: fd.get("email").trim(),
    password,
    nombre: fd.get("nombre").trim(),
    // La Edge Function todavía escribe `perfiles.sede_id`, que quedó EN DESUSO.
    // Las sedes de verdad se dan de alta acá abajo, en `perfil_sedes`.
    sede_id: null,
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  setLoading(submitBtn, true, "Creando...");

  try {
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/crear-usuario`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(payload),
    });

    const resultado = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = resultado?.error || "No se pudo crear el usuario.";
      errorEl.classList.remove("hidden");
      return;
    }

    // La función devuelve el id del perfil recién creado; sin él no hay a quién
    // colgarle las sedes.
    const nuevoId = resultado?.id ?? resultado?.usuario?.id ?? null;

    if (nuevoId) {
      const { error: errSedes } = await supabase
        .from("perfil_sedes")
        .insert(sedes.map((sede_id) => ({ perfil_id: nuevoId, sede_id })));
      if (errSedes) console.error("No se pudieron asignar las sedes:", errSedes);
    }

    form.reset();
    pintarChecksSedes(document.getElementById("nuevo-usuario-sedes"), []);

    // Recién creado: entra de una vez a los correos de aviso de sus sedes.
    const correos = await sincronizarCorreos(payload.email, sedes, true);

    if (!nuevoId) {
      showToast("Trabajador creado, pero hay que marcarle las sedes desde Editar.", "error");
    } else {
      showToast(correos.ok
        ? `Trabajador creado. Gestiona ${listarNombres(sedes)} y recibirá sus avisos.`
        : "Trabajador creado, pero no se pudieron configurar sus correos de aviso.");
    }

    await cargarUsuarios();
    await cargarNotificaciones();
  } catch (err) {
    console.error(err);
    errorEl.textContent =
      "No se pudo contactar al servidor. ¿Está desplegada la función `crear-usuario`?";
    errorEl.classList.remove("hidden");
  } finally {
    setLoading(submitBtn, false);
  }
}
