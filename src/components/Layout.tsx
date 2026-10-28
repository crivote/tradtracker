import { Show, type ParentComponent } from 'solid-js';
import { A, Navigate, useLocation } from '@solidjs/router';
import { useSession } from '../lib/session';
import { supabaseConfigError } from '../lib/supabase';

/**
 * Armazón de la app y guard de rutas (issue #6): sin sesión no se ve dato alguno,
 * solo el login. Mientras getSession() no responde no se redirige, para no expulsar
 * a un usuario con sesión válida en cada recarga.
 */
export const Layout: ParentComponent = (props) => {
  const session = useSession();
  const location = useLocation();

  const redirectTo = (): string | null => {
    if (!session.ready()) return null;
    const signedIn = Boolean(session.session());
    if (!signedIn && location.pathname !== '/login') return '/login';
    if (signedIn && location.pathname === '/login') return '/';
    return null;
  };

  return (
    <div class="min-h-screen bg-gray-900 text-gray-100">
      <Show when={redirectTo()}>{(target) => <Navigate href={target()} />}</Show>

      <header class="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold text-amber-400">🎵 TradTracker</h1>
            <p class="text-xs text-gray-400 mt-1">Irish Traditional Music Practice Manager</p>
          </div>

          <Show when={session.session()}>
            <div class="flex items-center gap-4 text-sm">
              <A href="/" class="text-gray-300 hover:text-amber-300" end>
                Repertoire
              </A>
              <span class="text-gray-500 hidden sm:inline" title={session.session()!.user.email ?? ''}>
                {session.session()!.user.email}
              </span>
              <button
                type="button"
                class="rounded border border-gray-600 px-3 py-1.5 text-gray-300 hover:border-amber-500 hover:text-amber-300"
                onClick={() => void session.signOut()}
              >
                Sign out
              </button>
            </div>
          </Show>
        </div>
      </header>

      <Show when={supabaseConfigError}>
        <div class="border-b border-red-700 bg-red-900/60 px-6 py-2 text-sm text-red-100">
          <span class="font-semibold">Configuration problem:</span> {supabaseConfigError}
        </div>
      </Show>

      <main class="max-w-7xl mx-auto px-6 py-8">{props.children}</main>
    </div>
  );
};
