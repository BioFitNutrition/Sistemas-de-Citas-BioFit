// Edge Function: notify-cita
// Envía los correos del sistema usando el Gmail de BioFit vía SMTP.
//
// Cuatro tipos de correo:
//   1. Cita nueva      -> aviso interno a los correos de `notificaciones_sede`
//   2. Cita nueva      -> confirmación al socio
//   3. Cita cancelada  -> aviso interno a los correos de `notificaciones_sede`
//   4. Cita delegada   -> aviso al trabajador asignado (EN DESUSO: la delegación
//      se eliminó el 25/09/2026 y su trigger ya no existe)
//
// IMPORTANTE: responde 200 de inmediato y manda el correo en SEGUNDO PLANO
// (EdgeRuntime.waitUntil). Conectarse a Gmail por SMTP puede tardar varios
// segundos, y quien nos llama (pg_net) corta la espera. Si respondiéramos al
// final, el corte mataría la ejecución antes de enviar nada.
//
// Secretos: GMAIL_USER, GMAIL_APP_PASSWORD, WEBHOOK_SECRET
//
// ⚠️ Se despliega con verify_jwt = false: la llama un Database Webhook, que no
// manda JWT. La autenticación es el header `x-webhook-secret`.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

// Dónde vive la página del socio. Se usa para el enlace de cancelación del
// correo. BioFit no tiene dominio propio, así que es la URL de GitHub Pages.
// Si algún día se compra un dominio, se cambia acá y se redespliega.
const SITIO_URL = "https://biofitnutrition.github.io/Sistemas-de-Citas-BioFit/";

const db = createClient(SUPABASE_URL, SERVICE_ROLE);

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return `<p style="margin:0 0 8px;font-size:14px;color:#171a1c"><strong style="color:#6b7280;font-weight:600">${etiqueta}:</strong> ${valor}</p>`;
}

// El botón de cancelar que ve el socio. Lleva el TOKEN, nunca el id de la cita:
// los uuid no son secretos y con el id cualquiera cancelaría citas ajenas.
// Sin token no se pinta nada: es lo que pasa con las citas anteriores al
// 26/09/2026 si alguien reenvía un correo viejo a mano.
function botonCancelar(token: string | null | undefined): string {
  if (!token) return "";
  const enlace = `${SITIO_URL}?cancelar=${encodeURIComponent(token)}`;
  return `
    <hr style="border:none;border-top:1px solid #e3e6e4;margin:20px 0" />
    <p style="margin:0 0 12px;font-size:13px;color:#6b7280">¿No vas a poder venir? Cancélala tú mismo hasta 2 horas antes, así el horario queda libre para otra persona.</p>
    <p style="margin:0"><a href="${enlace}" style="display:inline-block;padding:11px 22px;border-radius:999px;border:1px solid #dc2626;color:#dc2626;text-decoration:none;font-size:14px;font-weight:600">Cancelar mi cita</a></p>
    <p style="margin:12px 0 0;font-size:11px;color:#9ca3af">Este enlace es solo tuyo y deja de servir apenas lo uses.</p>
  `;
}

// ⚠️ NO QUITAR: esto es lo que arregla los "=20" que salían dentro del correo.
//
// El HTML de arriba viene indentado, así que varias líneas terminan en espacios
// (la del `${cuerpo}`, por ejemplo, queda con los 6 espacios del sangrado). Al
// codificar en quoted-printable, un espacio al final de línea OBLIGATORIAMENTE
// se escribe como "=20", y a Gmail en el celular le llegaba sin decodificar:
// aparecía un "=20" suelto arriba y otro abajo del mensaje.
//
// Se arregla en el origen: se deja el HTML en una sola línea, sin sangrado ni
// saltos. Así no hay espacio final que codificar, sea cual sea el encoder.
// Se une con un espacio (no vacío) para no pegar palabras si algún día un texto
// queda partido en dos líneas.
function compactar(html: string): string {
  return html.replace(/[ \t]*\r?\n[ \t]*/g, " ").trim();
}

// ⚠️ NO QUITAR, y NO volver a pasarle el asunto crudo a denomailer.
//
// denomailer 1.6.0 pasa el asunto por quotedPrintableEncodeInline(), que arma
// UN SOLO encoded-word `=?utf-8?Q?...?=` con tres defectos encadenados:
//   1. deja los espacios literales dentro del encoded-word, cosa que RFC 2047
//      prohíbe — por eso Gmail ni lo intenta decodificar y lo muestra crudo;
//   2. no lo corta en los 75 caracteres que exige la norma;
//   3. y encima le mete un salto de línea cada 74 caracteres SIN el espacio de
//      continuación.
// Ese tercer punto es el que rompe el correo entero: el salto parte la cabecera
// `Subject` en dos, la segunda mitad ya no tiene forma de cabecera, el lector da
// por cerrada la zona de cabeceras ahí mismo y TODO lo que sigue (From, To,
// Date, los boundaries MIME y el HTML) se muestra como texto plano.
// Pasó en producción el 26/09/2026 con el asunto
// "Nueva cita: Mónica Rivera carranza — Sede Jesús María".
//
// Aquí la cabecera se arma bien: encoded-words en Base64, cortados en límites de
// carácter y plegados con CRLF + espacio, que sí es la continuación válida.
//
// El espacio del principio NO es un descuido: quotedPrintableEncodeInline()
// vuelve a codificar todo lo que empiece con "=?", así que sin ese espacio
// nuestro trabajo quedaría codificado dos veces. Con él ve ASCII puro que no
// empieza con "=?" y lo deja pasar intacto, que es justo lo que queremos.
function asuntoCabecera(asunto: string): string {
  const limpio = asunto.replace(/[\r\n]+/g, " ").trim();

  // Solo ASCII imprimible y corto: no hay nada que codificar ni que plegar.
  if (!/[^\x20-\x7E]/.test(limpio) && limpio.length <= 68) return limpio;

  const enc = new TextEncoder();
  const trozos: string[] = [];
  let actual: number[] = [];

  for (const ch of limpio) {
    const bytes = Array.from(enc.encode(ch));
    // 36 bytes -> 48 caracteres de Base64 -> 60 con el envoltorio: holgado bajo
    // los 75 del RFC, y la primera línea queda en 70 contando "Subject: ".
    if (actual.length + bytes.length > 36) {
      trozos.push(aBase64(actual));
      actual = [];
    }
    actual.push(...bytes);
  }
  if (actual.length > 0) trozos.push(aBase64(actual));

  return " " + trozos.map((t) => `=?UTF-8?B?${t}?=`).join("\r\n ");
}

function aBase64(bytes: number[]): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

async function enviarCorreo(destinatarios: string[], asunto: string, html: string) {
  if (destinatarios.length === 0) return;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error("FALTAN SECRETOS: GMAIL_USER o GMAIL_APP_PASSWORD no están configurados");
    return;
  }

  console.log(`Conectando a Gmail para enviar a: ${destinatarios.join(", ")}`);

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });

  const cuerpo = compactar(html);
  const cabecera = asuntoCabecera(asunto);

  try {
    for (const to of destinatarios) {
      await client.send({
        from: `BioFit Consulting <${GMAIL_USER}>`,
        to,
        subject: cabecera,
        content: "auto",
        html: cuerpo,
      });
      console.log(`Correo enviado a ${to}`);
    }
  } catch (err) {
    console.error("Fallo al enviar por SMTP:", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    try { await client.close(); } catch { /* ignorar */ }
  }
}

async function datosSede(sedeId: string) {
  const { data } = await db.from("sedes").select("nombre, direccion").eq("id", sedeId).maybeSingle();
  return { nombre: data?.nombre ?? sedeId, direccion: data?.direccion ?? "" };
}

async function correosDeSede(sedeId: string): Promise<string[]> {
  const { data } = await db
    .from("notificaciones_sede")
    .select("email")
    .eq("sede_id", sedeId)
    .eq("activo", true);
  return (data ?? []).map((c: { email: string }) => c.email);
}

async function citaNueva(cita: Record<string, any>) {
  const sede = await datosSede(cita.sede_id);
  const cuando = `${formatearFecha(cita.fecha)} · ${formatearHora(cita.hora)}`;

  const destinatarios = await correosDeSede(cita.sede_id);
  console.log(`Cita nueva en ${sede.nombre}. Avisos internos: ${destinatarios.length}`);

  if (destinatarios.length > 0) {
    const html = plantilla("Nueva cita reservada", `
      ${filaDato("Socio", esc(cita.nombre_cliente))}
      ${cita.dni_cliente ? filaDato("DNI", esc(cita.dni_cliente)) : ""}
      ${filaDato("Sede", esc(sede.nombre))}
      ${filaDato("Cuándo", esc(cuando))}
      ${filaDato("Teléfono", esc(cita.telefono_cliente))}
      ${filaDato("Correo", esc(cita.email_cliente ?? "—"))}
    `);
    await enviarCorreo(destinatarios, `Nueva cita: ${cita.nombre_cliente} — ${sede.nombre}`, html);
  }

  if (cita.email_cliente) {
    const html = plantilla("¡Tu cita está confirmada!", `
      <p style="margin:0 0 16px;font-size:14px;color:#171a1c">Hola ${esc(cita.nombre_cliente)}, reservamos tu asesoría nutricional de 20 minutos.</p>
      ${filaDato("Cuándo", esc(cuando))}
      ${filaDato("Dónde", esc(sede.nombre))}
      ${sede.direccion ? filaDato("Dirección", esc(sede.direccion)) : ""}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Si necesitas reprogramar, contáctanos directamente. ¡Te esperamos!</p>
      ${botonCancelar(cita.token_cancelacion)}
    `);
    await enviarCorreo([cita.email_cliente], `Tu cita en BioFit — ${cuando}`, html);
  }
}

// Quién canceló sale de `cancelada_por_origen`, que lo llena la base (el
// trigger trg_marcar_quien_cancelo, o la función del token cuando es el socio).
// El frontend no lo manda: si lo mandara, un trabajador podría decir que canceló
// el admin.
function quienCancelo(origen: string | null | undefined): string {
  if (origen === "socio") return "El socio, desde el enlace de su correo";
  if (origen === "admin") return "El administrador, desde el panel";
  if (origen === "trabajador") return "Un trabajador, desde el panel";
  return "Sin registrar";
}

async function citaCancelada(cita: Record<string, any>) {
  const sede = await datosSede(cita.sede_id);
  const cuando = `${formatearFecha(cita.fecha)} · ${formatearHora(cita.hora)}`;

  const destinatarios = await correosDeSede(cita.sede_id);
  console.log(`Cita cancelada en ${sede.nombre}. Avisos internos: ${destinatarios.length}`);
  if (destinatarios.length === 0) return;

  const html = plantilla("Cita cancelada", `
    <p style="margin:0 0 16px;font-size:14px;color:#171a1c">Se canceló esta cita y el horario volvió a quedar libre para reservar.</p>
    ${filaDato("Socio", esc(cita.nombre_cliente))}
    ${cita.dni_cliente ? filaDato("DNI", esc(cita.dni_cliente)) : ""}
    ${filaDato("Sede", esc(sede.nombre))}
    ${filaDato("Era para", esc(cuando))}
    ${filaDato("Teléfono", esc(cita.telefono_cliente))}
    ${filaDato("Canceló", esc(quienCancelo(cita.cancelada_por_origen)))}
  `);

  await enviarCorreo(destinatarios, `Cita cancelada: ${cita.nombre_cliente} — ${sede.nombre}`, html);
}

async function citaDelegada(cita: Record<string, any>) {
  const { data: trabajador } = await db
    .from("perfiles")
    .select("email, nombre, activo")
    .eq("id", cita.asignado_a)
    .maybeSingle();

  if (!trabajador?.email || trabajador.activo !== true) {
    console.log("El trabajador asignado no existe o está inactivo; no se envía aviso.");
    return;
  }

  const sede = await datosSede(cita.sede_id);
  const cuando = `${formatearFecha(cita.fecha)} · ${formatearHora(cita.hora)}`;

  const html = plantilla("Te asignaron una cita", `
    <p style="margin:0 0 16px;font-size:14px;color:#171a1c">Hola ${esc(trabajador.nombre ?? "")}, te delegaron esta asesoría:</p>
    ${filaDato("Socio", esc(cita.nombre_cliente))}
    ${filaDato("Cuándo", esc(cuando))}
    ${filaDato("Sede", esc(sede.nombre))}
    ${sede.direccion ? filaDato("Dirección", esc(sede.direccion)) : ""}
    ${filaDato("Teléfono", esc(cita.telefono_cliente))}
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Ya puedes verla en tu panel de BioFit.</p>
  `);

  await enviarCorreo([trabajador.email], `Nueva cita asignada: ${cita.nombre_cliente} — ${cuando}`, html);
}

// Todo el trabajo pesado vive aquí y corre en segundo plano.
async function procesar(tipo: string, registro: Record<string, any>, anterior: Record<string, any> | undefined) {
  try {
    if (tipo === "INSERT") {
      await citaNueva(registro);
    } else if (tipo === "CANCELADA") {
      await citaCancelada(registro);
    } else if (tipo === "UPDATE") {
      const cambioAsignacion = registro.asignado_a && registro.asignado_a !== anterior?.asignado_a;
      if (cambioAsignacion && registro.estado !== "cancelada") {
        await citaDelegada(registro);
      }
    }
    console.log("Procesamiento terminado correctamente.");
  } catch (err) {
    console.error("Error procesando la notificación:", err instanceof Error ? err.message : String(err));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    console.error("Secreto del webhook incorrecto");
    return new Response("No autorizado", { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const tipo = String(payload?.type ?? "");
  const registro = payload?.record;
  const anterior = payload?.old_record;

  if (!registro) return new Response("Sin registro en el payload", { status: 400 });

  // Respondemos YA; el correo se manda en segundo plano.
  // @ts-ignore EdgeRuntime lo provee el entorno de Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(procesar(tipo, registro, anterior));
  } else {
    await procesar(tipo, registro, anterior);
  }

  return new Response("OK", { status: 200 });
});
