import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/**
 * Vite incrusta estas variables en el bundle **en tiempo de build**. Si faltan
 * (p. ej. porque están puestas como variables de runtime en Cloudflare y no de
 * build), la app no puede hablar con Supabase. Antes se lanzaba en el import y el
 * resultado era una pantalla en blanco sin explicación; ahora se avisa en la UI.
 */
export const supabaseConfigError: string | null =
  url && anonKey
    ? null
    : 'This build has no Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as BUILD variables and redeploy.';

/**
 * Cliente único de la app. Solo lleva la clave anónima (publishable): la
 * service_role/secret no viaja nunca al navegador (ver AGENTS.md).
 *
 * persistSession + autoRefreshToken son lo que hace que el login sobreviva a
 * recargas y reinicios del navegador (criterio de la issue #6).
 * detectSessionInUrl queda en false: no usamos OAuth ni magic link, así que no
 * hay nada que leer de la URL y evita canjear fragmentos que no esperamos.
 *
 * Sin configuración se construye un cliente inerte: no hay sesión que guardar y
 * cualquier consulta falla con un error que la UI muestra, en vez de romper el
 * arranque de la aplicación.
 */
export const supabase = createClient(
  url ?? 'https://unconfigured.supabase.co',
  anonKey ?? 'unconfigured-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);
