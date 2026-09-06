// @ts-nocheck  — este archivo corre en el runtime de Deno (Supabase Edge Functions),
// no en Node. VS Code marca "errores" falsos (global `Deno`, imports por URL) que no
// aplican al desplegar con `supabase functions deploy`. Para tipos reales, instala la
// extensión "Deno" de VS Code.
//
// Edge Function: notifica por email a Luis cuando se registra una cita nueva.
// Se dispara vía un Database Webhook de Supabase (INSERT en la tabla "citas").
//
// Variables de entorno necesarias (configúralas con `supabase secrets set`):
//   RESEND_API_KEY     -> API key de tu cuenta de Resend
//   ADMIN_EMAIL        -> email de Luis, donde llegan las notificaciones
//   RESEND_FROM_EMAIL  -> remitente verificado en Resend (opcional, usa el de pruebas por defecto)
//   WEBHOOK_SECRET      -> secreto compartido para validar que la llamada viene del webhook

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const NOMBRES_SEDE: Record<string, string> = {
  magdalena: "Magdalena del Mar",
  jesus_maria: "Jesús María",
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Valida el secreto compartido configurado en el header del webhook.
  if (WEBHOOK_SECRET) {
    const header = req.headers.get("x-webhook-secret");
    if (header !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const cita = payload?.record;
  if (!cita) {
    return new Response("No record in payload", { status: 400 });
  }

  if (!RESEND_API_KEY || !ADMIN_EMAIL) {
    console.error("Faltan variables de entorno RESEND_API_KEY o ADMIN_EMAIL");
    return new Response("Server misconfigured", { status: 500 });
  }

  const sedeNombre = NOMBRES_SEDE[cita.sede_id] ?? cita.sede_id;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2 style="color:#1f9d55;">Nueva cita reservada — BioFit</h2>
      <p><strong>Cliente:</strong> ${escapeHtml(cita.nombre_cliente)}</p>
      <p><strong>Sede:</strong> ${escapeHtml(sedeNombre)}</p>
      <p><strong>Fecha:</strong> ${escapeHtml(cita.fecha)} &nbsp;<strong>Hora:</strong> ${escapeHtml(cita.hora)}</p>
      <p><strong>Teléfono:</strong> ${escapeHtml(cita.telefono_cliente)}</p>
      <p><strong>Email:</strong> ${cita.email_cliente ? escapeHtml(cita.email_cliente) : "No proporcionado"}</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `Nueva cita: ${cita.nombre_cliente} — ${sedeNombre}`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend error:", errText);
    return new Response("Error sending email", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
