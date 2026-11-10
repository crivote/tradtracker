import { Show, type ParentComponent } from 'solid-js';
import { A, Navigate, useLocation } from '@solidjs/router';
import { useSession } from '../lib/session';
import { supabaseConfigError } from '../lib/supabase';
import { PlayerDock } from './PlayerDock';
import { BrandMark } from './BrandMark';

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

  /**
   * Las pantallas de papel —la home, el banco de trabajo, el listado de un
   * peldaño, el ensayo y la búsqueda— miden su propio marco y ya reservan su
   * fondo. Se declara una vez: la lista creció con `/learning` y `/level/:band`,
   * y repetirla en tres sitios es la forma de que una ruta nueva se quede sin
   * papel sin que nadie lo note.
   */
  const isPaper = (): boolean => {
    const path = location.pathname;
    return (
      path === '/' ||
      path === '/practice' ||
      path === '/search' ||
      path === '/learning' ||
      path.startsWith('/level/')
    );
  };

  return (
    <div
      class="app-shell min-h-screen bg-gray-900 text-gray-100"
      classList={{
        // Las pantallas de papel miden su propio fondo y su propio marco: la
        // reserva del dock se ajusta a eso (ver player-dock.css).
        'is-paper': isPaper(),
      }}
    >
      <Show when={redirectTo()}>{(target) => <Navigate href={target()} />}</Show>

      <header class="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 text-[#8FB79A]">
            <BrandMark class="h-10 w-auto shrink-0" />
            <div>
              <h1 class="text-2xl font-bold leading-none">tuneshed</h1>
              <p class="text-xs text-gray-400 mt-1">Irish Traditional Music Practice Manager</p>
            </div>
          </div>

          <Show when={session.session()}>
            {/* Con cinco puertas y el correo, la fila no cabe en una pantalla de
                780 px: envuelve en vez de empujar el ancho del documento. */}
            <div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
              <A href="/" class="text-gray-300 hover:text-amber-300" end>
                Repertoire
              </A>
              <A href="/learning" class="text-gray-300 hover:text-amber-300">
                Learning
              </A>
              <A href="/practice" class="text-gray-300 hover:text-amber-300">
                Practice
              </A>
              <A href="/search" class="text-gray-300 hover:text-amber-300">
                Search
              </A>
              <A href="/about" class="text-gray-300 hover:text-amber-300">
                About
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

      {/*
        Las pantallas de papel miden su propio marco: el contrato del boceto fija
        `padding: 52px clamp(18px, 4vw, 58px) 90px` en la pantalla y una carta de
        282 px a 1280 px. Si el `main` añadiera sus 24 px de padding, la rejilla se
        quedaría 20 px corta; por eso estas rutas van a sangre y las demás
        conservan el contenedor de siempre.

        Son cinco desde el corte de pantallas: la home del repertorio (#29), la
        búsqueda (#9), la lista de ensayo (#36), el banco de trabajo (`/learning`,
        #52) y el listado de un peldaño (`/level/:band`, #42). Las tres últimas
        comparten el marco de papel y no lo redeclaran.
      */}
      <main class={isPaper() ? '' : 'max-w-7xl mx-auto px-6 py-8'}>{props.children}</main>

      {/*
        Un solo reproductor para toda la app (#49). Vive aquí, en el armazón, y
        no en las vistas: es lo que hace que la música sobreviva a la navegación
        y que ninguna pantalla instancie su propio transporte.
      */}
      <PlayerDock />
    </div>
  );
};
