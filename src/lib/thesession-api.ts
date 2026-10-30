/**
 * Adaptador de red del tunebook de thesession.org (issue #32).
 *
 * Aquí y solo aquí se hace `fetch`; el parseo, el deduplicado y las filas
 * viven en `thesession-import.ts`. Sigue el patrón de `image-search.ts`: error
 * propio con `kind`, `fetch` global y ninguna clave.
 *
 * Medido contra el servicio: CORS abierto (`access-control-allow-origin: *`),
 * `perpage` máximo 50, y una cuenta inexistente o borrada responde **410**, no
 * 404. Se pide de página en página con una pausa corta: el listado es público y
 * no hace falta martillearlo.
 */
import {
  SESSION_MAX_PAGES,
  SESSION_PER_PAGE,
  dedupeTunebook,
  parseMemberSearch,
  parseTunebookPage,
  type SessionMember,
  type SessionTune,
  type SessionTunebookPage,
} from './thesession-import';

export const SESSION_API_BASE = 'https://thesession.org';

/** Pausa entre páginas del tunebook (no se aplica tras la última). */
export const SESSION_PAGE_DELAY_MS = 250;

/**
 * Errores con causa distinguible. La pantalla tiene que separar «esa cuenta ya
 * no existe» (`gone`) de «el servicio falla» (`http` / `network`) y de «ese
 * tunebook es demasiado grande para importarlo de golpe» (`too-large`).
 */
export type SessionImportErrorKind = 'gone' | 'http' | 'network' | 'too-large';

export class SessionImportError extends Error {
  readonly kind: SessionImportErrorKind;
  readonly status?: number;

  constructor(message: string, kind: SessionImportErrorKind, status?: number) {
    super(message);
    this.name = 'SessionImportError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Una petición JSON al API, con los cuatro modos de fallo ya clasificados. */
async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new SessionImportError(`Could not reach thesession.org: ${describe(cause)}`, 'network');
  }

  if (response.status === 410) {
    throw new SessionImportError(
      'That member no longer exists on thesession.org — check the profile link.',
      'gone',
      410
    );
  }
  if (!response.ok) {
    throw new SessionImportError(`thesession.org responded ${response.status}.`, 'http', response.status);
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new SessionImportError(
      `thesession.org sent something that is not JSON: ${describe(cause)}`,
      'http',
      response.status
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Buscador de miembros. Existe porque la URL de ficha no resuelve por nombre de
 * usuario: `/members/<nombre>/tunebook` da 404, así que hay que llegar al id.
 */
export async function searchMembers(name: string): Promise<SessionMember[]> {
  const query = (name ?? '').trim();
  if (query === '') return [];

  const url = new URL('/members/search', SESSION_API_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  return parseMemberSearch(await fetchJson(url.toString()));
}

function tunebookUrl(memberId: number, page: number): string {
  const url = new URL(`/members/${memberId}/tunebook`, SESSION_API_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('perpage', String(SESSION_PER_PAGE));
  url.searchParams.set('page', String(page));
  return url.toString();
}

/**
 * El tunebook entero, página a página, deduplicado. `onPage` se llama por cada
 * página para que la pantalla pueda ir contando; el total se conoce al final.
 *
 * El techo se comprueba con la primera página, antes de pedir la segunda: un
 * tunebook de miles de tunes se rechaza en una sola petición, no gastando
 * cuarenta.
 */
export async function fetchTunebook(
  memberId: number,
  onPage?: (page: SessionTunebookPage) => void
): Promise<SessionTune[]> {
  const first = parseTunebookPage(await fetchJson(tunebookUrl(memberId, 1)));

  if (first.pages > SESSION_MAX_PAGES) {
    throw new SessionImportError(
      `That tunebook has ${first.pages} pages — more than the ${SESSION_MAX_PAGES} this import handles.`,
      'too-large'
    );
  }

  const tunes = [...first.tunes];
  onPage?.(first);

  for (let page = 2; page <= first.pages; page += 1) {
    await sleep(SESSION_PAGE_DELAY_MS);
    const next = parseTunebookPage(await fetchJson(tunebookUrl(memberId, page)));
    tunes.push(...next.tunes);
    onPage?.(next);
  }

  return dedupeTunebook(tunes);
}
