// ============================================
// Edge Function: notify-cita
// ============================================
// Envía los correos del sistema usando el Gmail de BioFit vía SMTP.
// No se usa Resend porque BioFit no tiene dominio propio, y sin dominio
// verificado Resend solo permite enviar a la dirección de la propia cuenta.
//
// Son TRES tipos de correo:
//   1. Cita nueva  -> aviso interno a los correos de `notificaciones_sede`
//   2. Cita nueva  -> confirmación al socio
//   3. Cita delegada -> aviso al trabajador asignado
//
// Se dispara con Database Webhooks:
//   - INSERT en `citas`  -> correos 1 y 2
//   - UPDATE en `citas`  -> correo 3 (cuando cambia `asignado_a`)
//
// Desplegar:
//   supabase functions deploy notify-cita --no-verify-jwt
//
// Secretos:
//   supabase secrets set GMAIL_USER=biofit.consulting1@gmail.com
//   supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
//   supabase secrets set WEBHOOK_SECRET=algo-largo-y-aleatorio
//
// La contraseña de aplicación se genera en la cuenta de Google con la
// verificación en 2 pasos activada. NO es la contraseña normal del Gmail.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "jsr:@denodrivers/smtp";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const db = createClient(SUPABASE_URL, SERVICE_ROLE);

// ---------- utilidades ----------

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const texto = fecha.toLocaleDateString("es-PE", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatearHora(hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const sufijo = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${sufijo}`;
}

function plantilla(titulo: string, cuerpo: string): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#f7f8f7;padding:24px">
    <div style="background:#0d0f0e;padding:20px 24px;border-radius:14px 14px 0 0;border-bottom:3px solid #88e300">
      <h1 style="margin:0;color:#42c4a8;font-size:20px;letter-spacing:1px">BIOFIT</h1>
      <p style="margin:4px 0 0;color:#d4cbb9;font-size:12px">Ciencia que transforma tu cuerpo</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 14px 14px;border:1px solid #e3e6e4;border-top:none">
      <h2 style="margin:0 0 16px;color:#147362;font-size:18px">${titulo}</h2>
      ${cuerpo}
    </div>
    <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:16px">
      BioFit Consulting — Asesoría nutricional
    </p>
  </div>`;
}

function filaDato(etiqueta: string, valor: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;color:#171a1c">
    <strong style="color:#6b7280;font-weight:600">${etiqueta}:</strong> ${valor}
  </p>`;
}

async function enviarCorreo(destinatarios: string[], asunto: string, html: string) {
  if (destinatarios.length === 0) return;

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });

  try {
    for (const to of destinatarios) {
      await client.send({
        from: `BioFit Consulting <${GMAIL_USER}>`,
        to,
        subject: asunto,
        content: "auto",
        html,
      });
    }
  } finally {
    await client.close();
  }
}

// ---------- lógica de negocio ----------

async function datosSede(sedeId: string) {
  const { data } = await db
    .from("sedes")
    .select("nombre, direccion")
    .eq("id", sedeId)
    .maybeSingle();
  return { nombre: data?.nombre ?? sedeId, direccion: data?.direccion ?? "" };
}

// 1 y 2: cita nueva
async function citaNueva(cita: Record<string, any>) {
  const sede = await datosSede(cita.sede_id);
  const cuando = `${formatearFecha(cita.fecha)} · ${formatearHora(cita.hora)}`;

  // --- Aviso interno ---
  const { data: correos } = await db
    .from("notificaciones_sede")
    .select("email")
    .eq("sede_id", cita.sede_id)
    .eq("activo", true);

  const destinatarios = (correos ?? []).map((c: { email: string }) => c.email);

  if (destinatarios.length > 0) {
    const html = plantilla("Nueva cita reservada", `
      ${filaDato("Socio", esc(cita.nombre_cliente))}
      ${filaDato("Sede", esc(sede.nombre))}
      ${filaDato("Cuándo", esc(cuando))}
      ${filaDato("Teléfono", esc(cita.telefono_cliente))}
      ${filaDato("Correo", esc(cita.email_cliente ?? "—"))}
    `);
    await enviarCorreo(
      destinatarios,
      `Nueva cita: ${cita.nombre_cliente} — ${sede.nombre}`,
      html,
    );
  }

  // --- Confirmación al socio ---
  if (cita.email_cliente) {
    const html = plantilla("¡Tu cita está confirmada!", `
      <p style="margin:0 0 16px;font-size:14px;color:#171a1c">
        Hola ${esc(cita.nombre_cliente)}, reservamos tu asesoría nutricional de 20 minutos.
      </p>
      ${filaDato("Cuándo", esc(cuando))}
      ${filaDato("Dónde", esc(sede.nombre))}
      ${sede.direccion ? filaDato("Dirección", esc(sede.direccion)) : ""}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">
        Si necesitas reprogramar o cancelar, contáctanos directamente. ¡Te esperamos!
      </p>
    `);
    await enviarCorreo(
      [cita.email_cliente],
      `Tu cita en BioFit — ${cuando}`,
      html,
    );
  }
}

// 3: cita delegada a un trabajador
async function citaDelegada(cita: Record<string, any>) {
  const { data: trabajador } = await db
    .from("perfiles")
    .select("email, nombre, activo")
    .eq("id", cita.asignado_a)
    .maybeSingle();

  if (!trabajador?.email || trabajador.activo !== true) return;

  const sede = await datosSede(cita.sede_id);
  const cuando = `${formatearFecha(cita.fecha)} · ${formatearHora(cita.hora)}`;

  const html = plantilla("Te asignaron una cita", `
    <p style="margin:0 0 16px;font-size:14px;color:#171a1c">
      Hola ${esc(trabajador.nombre ?? "")}, te delegaron esta asesoría:
    </p>
    ${filaDato("Socio", esc(cita.nombre_cliente))}
    ${filaDato("Cuándo", esc(cuando))}
    ${filaDato("Sede", esc(sede.nombre))}
    ${sede.direccion ? filaDato("Dirección", esc(sede.direccion)) : ""}
    ${filaDato("Teléfono", esc(cita.telefono_cliente))}
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280">
      Ya puedes verla en tu panel de BioFit.
    </p>
  `);

  await enviarCorreo(
    [trabajador.email],
    `Nueva cita asignada: ${cita.nombre_cliente} — ${cuando}`,
    html,
  );
}

// ---------- entrada ----------

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  // Valida el secreto compartido configurado en el header del webhook
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("No autorizado", { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const tipo = payload?.type;              // INSERT | UPDATE
  const registro = payload?.record;
  const anterior = payload?.old_record;

  if (!registro) return new Response("Sin registro en el payload", { status: 400 });

  try {
    if (tipo === "INSERT") {
      await citaNueva(registro);
    } else if (tipo === "UPDATE") {
      // Solo avisamos si la cita pasó a estar asignada a alguien distinto.
      const cambioAsignacion = registro.asignado_a && registro.asignado_a !== anterior?.asignado_a;
      if (cambioAsignacion && registro.estado !== "cancelada") {
        await citaDelegada(registro);
      }
    }
  } catch (err) {
    console.error("Error enviando correo:", err);
    return new Response("Error al enviar el correo", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
