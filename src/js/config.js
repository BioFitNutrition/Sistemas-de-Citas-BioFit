// ============================================
// CONFIGURACIÓN
// ============================================
// Es seguro exponer estos dos valores en el frontend: el acceso real lo controlan
// las políticas de Row Level Security definidas en la base de datos.

export const SUPABASE_URL = "https://snuefzvfhucgfllnifat.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNudWVmenZmaHVjZ2ZsbG5pZmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NjY3NzcsImV4cCI6MjEwNDI0Mjc3N30.EqvYZaHhvuXmhg9B0Amf1otTHB9X8NZ9pRB0vVUIA8c";

// Duración de cada cita en minutos.
export const DURACION_CITA_MIN = 20;

// Nombre del servicio que se muestra al socio.
export const NOMBRE_SERVICIO = "Asesoría nutricional";

// Texto de zona horaria mostrado junto a los horarios.
export const ZONA_HORARIA = "Hora de Perú (GMT−5)";

// Color de respaldo si una sede no tiene color definido en la base.
export const COLOR_SEDE_DEFECTO = "#147362";
