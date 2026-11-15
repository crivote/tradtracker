/**
 * De dónde se abrió la ficha de un tune, para que su enlace de vuelta regrese a
 * esa pantalla —con su filtro— en lugar de ir siempre a la home.
 *
 * El origen viaja en la URL (`/repertoire/:id?from=<ruta>`), no en memoria de
 * sesión: sobrevive a recargar la ficha, a abrirla en otra pestaña y a compartir
 * el enlace, y se puede probar sin montar la app. Se aceptan solo las pantallas
 * del repertorio que enlazan al detalle; cualquier otra cosa cae a la home, que
 * es el destino seguro.
 *
 * `from` no puede ser una URL externa: el valor se resuelve contra una base
 * falsa y se exige que el origen siga siendo el de la base. Así `//evil.example`
 * y `javascript:…` no llegan nunca a un `href`.
 */
import { useLocation } from '@solidjs/router';
import { BACKLOG_SCOPE, SHELVED_SCOPE, bandFor, parseScope } from './repertoire-model';

/** Parámetro de la URL de la ficha que guarda la pantalla de origen. */
export const FROM_PARAM = 'from';

const BASE = 'http://tuneshed.invalid';

export interface BackTarget {
  /** Ruta a la que vuelve el enlace, ya con la consulta del origen. */
  href: string;
  /** Rótulo del enlace, nombrando la pantalla de destino. */
  label: string;
}

const HOME: BackTarget = { href: '/', label: 'Back to repertoire' };

/**
 * La pantalla de la que se llegó, con el nombre que lleva su cabecera. Sin
 * `from`, con una ruta que no es del repertorio o con basura, la home: es el
 * único destino que siempre existe.
 */
export function resolveBackTarget(raw: string | null | undefined): BackTarget {
  if (!raw) return HOME;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return HOME;
  }
  if (url.origin !== BASE) return HOME;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = url.search;

  if (path === '/') return { href: `/${query}`, label: 'Back to repertoire' };
  if (path === '/learning') return { href: `/learning${query}`, label: 'Back to learning' };
  if (path === '/practice') return { href: `/practice${query}`, label: 'Back to practice list' };
  if (path === '/history') return { href: `/history${query}`, label: 'Back to practice history' };
  if (path === '/search') return { href: `/search${query}`, label: 'Back to search' };

  const level = /^\/level\/([a-z_]+)$/.exec(path);
  if (!level) return HOME;

  const band = level[1];
  const href = `/level/${band}${query}`;

  if (band === 'all') return { href, label: 'Back to all tunes' };
  if (band === BACKLOG_SCOPE) return { href, label: 'Back to the backlog' };

  const scope = parseScope(band);
  if (!scope) return HOME;
  // El cajón no es un peldaño y `/level/learning` redirige a `/learning`: cada
  // uno vuelve a su pantalla, no a una lista que redirige.
  if (scope === SHELVED_SCOPE) return { href, label: 'Back to shelved' };
  if (scope === 'learning') return { href: `/learning${query}`, label: 'Back to learning' };
  return { href, label: `Back to ${bandFor(scope).label.toLowerCase()}` };
}

/**
 * Ruta a la ficha desde una pantalla concreta. En la home no se ensucia la URL:
 * sin `from`, el destino de vuelta ya es la home.
 */
export function tuneHref(repertoireId: string, origin?: string | null): string {
  const base = `/repertoire/${repertoireId}`;
  if (!origin || origin === '/') return base;
  return `${base}?${FROM_PARAM}=${encodeURIComponent(origin)}`;
}

/**
 * Enlace a la ficha desde la pantalla que lo pinta: la ruta actual —con su
 * consulta, para no perder el filtro— es el origen que la ficha devolverá. Se
 * llama en el cuerpo del componente, nunca dentro de un callback de datos.
 */
export function useTuneHref(): (repertoireId: string) => string {
  const location = useLocation();
  return (repertoireId: string) => tuneHref(repertoireId, location.pathname + location.search);
}
