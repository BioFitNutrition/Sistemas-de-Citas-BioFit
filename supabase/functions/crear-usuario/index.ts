// ============================================
// Edge Function: crear-usuario
// ============================================
// Crea una cuenta de TRABAJADOR. Solo puede llamarla un administrador.
//
// El cuerpo acepta sede_id con una sede concreta, o null para un trabajador que
// cubre TODAS las sedes (así lo guarda perfiles.sede_id y así lo leen las
// políticas RLS de horarios_disponibles).
//
// Por qué existe: crear usuarios en Supabase Auth requiere la service_role key,
// que jamás puede estar en el frontend (el repositorio es público). Esta función
// vive en el servidor, valida que quien llama sea admin, y recién ahí usa la key.
//
// Desplegar:
//   supabase functions deploy crear-usuario
//
// Secretos necesarios (ya vienen por defecto en Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // ---- 1. Identificar a quien llama ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return json({ error: "Falta el token de sesión." }, 401);

  const clienteUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: errUser } = await clienteUsuario.auth.getUser();
  if (errUser || !user) return json({ error: "Sesión inválida." }, 401);

  // ---- 2. Verificar que sea ADMIN (no confiar en el frontend) ----
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: perfil } = await admin
    .from("perfiles")
    .select("rol, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || perfil.rol !== "admin" || perfil.activo !== true) {
    return json({ error: "Solo un administrador puede crear usuarios." }, 403);
  }

  // ---- 3. Validar los datos recibidos ----
  // `unknown` y no `string`: sede_id puede llegar como null, que es un valor
  // legítimo y significa "cubre todas las sedes".
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const email = texto(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const nombre = texto(body.nombre);

  // Convención de la base: perfiles.sede_id NULL = el trabajador cubre TODAS
  // las sedes. Un sede_id ausente o null llega aquí como "" y significa eso.
  const sedeId = texto(body.sede_id);
  const cubreTodasLasSedes = sedeId === "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Correo electrónico inválido." }, 400);
  }
  if (password.length < 8) {
    return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  }

  // Si eligió una sede concreta, sigue teniendo que existir.
  if (!cubreTodasLasSedes) {
    const { data: sede } = await admin
      .from("sedes")
      .select("id")
      .eq("id", sedeId)
      .maybeSingle();
    if (!sede) return json({ error: "La sede indicada no existe." }, 400);
  }

  // ---- 4. Crear el usuario en Auth ----
  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,   // sin verificación por correo: lo crea el admin
  });

  if (errCrear || !creado?.user) {
    const msg = String(errCrear?.message ?? "");
    if (msg.toLowerCase().includes("already")) {
      return json({ error: "Ya existe un usuario con ese correo." }, 409);
    }
    console.error("Error al crear usuario:", errCrear);
    return json({ error: "No se pudo crear el usuario." }, 500);
  }

  // ---- 5. Crear su perfil con rol de trabajador ----
  const { error: errPerfil } = await admin.from("perfiles").insert({
    id: creado.user.id,
    email,
    nombre: nombre || email,
    rol: "trabajador",
    sede_id: cubreTodasLasSedes ? null : sedeId,
    activo: true,
  });

  if (errPerfil) {
    // Si el perfil falla, deshacemos el usuario para no dejar cuentas huérfanas.
    await admin.auth.admin.deleteUser(creado.user.id);
    console.error("Error al crear el perfil:", errPerfil);
    return json({ error: "No se pudo crear el perfil del usuario." }, 500);
  }

  return json({ ok: true, id: creado.user.id, email });
});
