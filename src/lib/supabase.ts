import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. Copy .env.example to .env.local.'
  );
}

/**
 * Cliente único de la app. Solo lleva la clave anónima (publishable): la
 * service_role/secret no viaja nunca al navegador (ver AGENTS.md).
 *
 * persistSession + autoRefreshToken son lo que hace que el login sobreviva a
 * recargas y reinicios del navegador (criterio de la issue #6).
 * detectSessionInUrl queda en false: no usamos OAuth ni magic link, así que no
 * hay nada que leer de la URL y evita canjear fragmentos que no esperamos.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
