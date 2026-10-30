/**
 * Adaptador de red del buscador de fondos (issue #31): Wikimedia Commons y
 * Pexels. Aquí y solo aquí se hace `fetch`; lo puro está en `image-sources.ts`.
 *
 * Medidas que esta capa respeta:
 *   · Commons **exige `User-Agent`** en peticiones de servidor (el navegador no
 *     deja ponerlo: lo ignora, y ahí el que manda es el del navegador; en el
 *     Worker y en Node sí viaja).
 *   · `iiurlwidth=330` para el mosaico (21 KB por imagen, 422 KB el tune);
 *     960 solo al ampliar para encuadrar. **Nunca** se compone la ruta de la
 *     miniatura: se guarda el `thumburl` que devuelve el API — una ruta
 *     inventada da 400.
 *   · Pexels: CORS abierto, clave del usuario en la cabecera `Authorization`
 *     (sin `Bearer`), `orientation=landscape` para descartar verticales en
 *     origen.
 */
import {
  CANDIDATE_COUNT,
  COMMONS_FULL_WIDTH,
  COMMONS_THUMB_WIDTH,
  PEXELS_PER_PAGE,
  candidateKey,
  commonsQueries,
  mergeCandidates,
  parseCommonsResponse,
  parsePexelsResponse,
  pexelsSearchUrl,
  type CandidateLane,
  type ImageCandidate,
  type ImageRegister,
  type SearchSource,
} from './image-sources';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Wikimedia pide identificar la herramienta. Se deja el contacto del proyecto en
 * lugar de un UA de navegador: si abusan del API, lo que se corta es esto.
 */
export const COMMONS_USER_AGENT =
  'TradTracker/0.1 (Irish traditional music practice manager; +https://tradtracker.crivote.workers.dev)';

/**
 * Errores con causa distinguible. La pantalla tiene que separar «falta la clave»
 * de «clave rechazada» (400 y 401 no son lo mismo para el usuario).
 */
export type ImageSearchErrorKind = 'missing-key' | 'rejected' | 'http' | 'network';

export class ImageSearchError extends Error {
  readonly kind: ImageSearchErrorKind;

  constructor(message: string, kind: ImageSearchErrorKind) {
    super(message);
    this.name = 'ImageSearchError';
    this.kind = kind;
  }
}

/** Una llamada al API de Commons. `origin=*` habilita CORS desde el navegador. */
async function commonsApi(params: Record<string, string>): Promise<any> {
  const url = new URL(COMMONS_API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': COMMONS_USER_AGENT, Accept: 'application/json' },
    });
  } catch (cause) {
    throw new ImageSearchError(
      `Could not reach Wikimedia Commons: ${cause instanceof Error ? cause.message : String(cause)}`,
      'network'
    );
  }

  if (!response.ok) {
    throw new ImageSearchError(`Wikimedia Commons responded ${response.status}.`, 'http');
  }
  return response.json();
}

/** Una consulta de un carril (`generator=search` en el espacio de ficheros). */
async function commonsLane(search: string, limit: number): Promise<ImageCandidate[]> {
  const payload = await commonsApi({
    action: 'query',
    generator: 'search',
    gsrsearch: search,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iiurlwidth: String(COMMONS_THUMB_WIDTH),
  });
  return parseCommonsResponse(payload, search);
}

/**
 * Los nueve candidatos de Commons: todas las consultas en paralelo y la fusión
 * con cupo y relleno. Un carril que falla no tumba el mosaico — se queda sin
 * resultados y el relleno tapa el hueco. Si fallan **todos**, el error sube: no
 * es «sin referente», es que no hay red.
 */
export async function searchCommons(
  words: string,
  register: ImageRegister = 'both'
): Promise<ImageCandidate[]> {
  const queries = commonsQueries(words, register);
  if (queries.length === 0) return [];

  const settled = await Promise.allSettled(
    queries.map((query) => commonsLane(query.search, query.limit))
  );

  if (settled.every((result) => result.status === 'rejected')) {
    const first = settled[0] as PromiseRejectedResult;
    throw first.reason instanceof Error
      ? first.reason
      : new ImageSearchError('Could not reach Wikimedia Commons.', 'network');
  }

  const lanes: CandidateLane[] = queries.map((query, index) => {
    const result = settled[index];
    return {
      kind: query.kind,
      candidates: result.status === 'fulfilled' ? result.value : [],
    };
  });

  return mergeCandidates(lanes, CANDIDATE_COUNT);
}

/**
 * El grande (960) de un candidato de Commons, pedido **solo al ampliar**.
 *
 * Se pide por título de fichero y se guarda el `thumburl` que devuelve el API.
 * Si la petición falla, se devuelve la URL que ya se tenía: el recuadro se
 * encuadra igual con la miniatura, peor de resolución.
 */
export async function enlargeCommons(candidate: ImageCandidate): Promise<string> {
  if (candidate.source !== 'commons') return candidate.fullUrl;
  if (candidate.fullUrl !== candidate.thumbUrl) return candidate.fullUrl;

  try {
    const payload = await commonsApi({
      action: 'query',
      titles: `File:${candidate.id}`,
      prop: 'imageinfo',
      iiprop: 'url|size',
      iiurlwidth: String(COMMONS_FULL_WIDTH),
    });
    const pages: Record<string, any> = payload?.query?.pages ?? {};
    const page = Object.values(pages)[0];
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    const thumb: string = info?.thumburl ?? '';
    return thumb || candidate.thumbUrl;
  } catch {
    return candidate.thumbUrl;
  }
}

/** Los nueve candidatos de Pexels. Sin clave no hay petición: es un aviso, no un error de red. */
export async function searchPexels(words: string, apiKey: string): Promise<ImageCandidate[]> {
  const key = (apiKey ?? '').trim();
  if (key.length === 0) {
    throw new ImageSearchError(
      'Pexels needs your API key — paste it below; it stays in this browser.',
      'missing-key'
    );
  }

  let response: Response;
  try {
    response = await fetch(pexelsSearchUrl(words, PEXELS_PER_PAGE), {
      headers: { Authorization: key, Accept: 'application/json' },
    });
  } catch (cause) {
    throw new ImageSearchError(
      `Could not reach Pexels: ${cause instanceof Error ? cause.message : String(cause)}`,
      'network'
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ImageSearchError('Pexels rejected that key — check it and paste it again.', 'rejected');
  }
  if (!response.ok) {
    throw new ImageSearchError(`Pexels responded ${response.status}.`, 'http');
  }

  const payload = await response.json();
  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];
  for (const candidate of parsePexelsResponse(payload)) {
    const key_ = candidateKey(candidate);
    if (seen.has(key_)) continue;
    seen.add(key_);
    candidates.push(candidate);
    if (candidates.length >= CANDIDATE_COUNT) break;
  }
  return candidates;
}

/** Lo que necesita la pantalla para pedir un mosaico. */
export interface ImageSearchRequest {
  words: string;
  source: SearchSource;
  register?: ImageRegister;
  /** Clave de Pexels del usuario; solo se usa si `source === 'pexels'`. */
  pexelsKey?: string;
}

/** Punto de entrada único del adaptador: elige la fuente y devuelve hasta nueve. */
export async function searchCandidates(request: ImageSearchRequest): Promise<ImageCandidate[]> {
  if (request.source === 'pexels') {
    return searchPexels(request.words, request.pexelsKey ?? '');
  }
  return searchCommons(request.words, request.register ?? 'both');
}
