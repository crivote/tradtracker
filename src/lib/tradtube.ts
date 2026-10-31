/**
 * Adaptador de TradTube (#37): los vídeos de una lista de ensayo, en **una sola
 * petición por lista**.
 *
 * TradTube es otro Supabase (`kshrrvowxibjqhsvijgh`). Aquí solo se lee, con su
 * clave **anónima pública** (la misma que viaja en el bundle de TradTube): no
 * hay proxy, ni función de Worker, ni copia de la base.
 *
 * Lo puro (id de YouTube, miniatura, URL del iframe, filas → segmentos) vive
 * aquí y se prueba sin red; lo que hace `fetch` es solo `fetchSegments`.
 *
 * Cuatro medidas que esta capa respeta (verificadas contra el servicio real el
 * 2026-10-31):
 *   1. `tune_id=in.(…)` con el filtro `tune_media.hidden=eq.false` **sobre el
 *      recurso embebido** devuelve 200 con la clave anónima. Una petición por
 *      lista, en tandas de 100 por si la lista crece.
 *   2. `end_sec` es NULLABLE: el iframe **omite** `end` cuando falta (poner
 *      `end=null` rompe el reproductor).
 *   3. No hay columna de miniatura: sale del id de YouTube
 *      (`i.ytimg.com/vi/<id>/mqdefault.jpg`).
 *   4. Una tune puede tener varios segmentos y se devuelven **todos**, ordenados.
 *
 * Dos divergencias conscientes respecto del frontal de TradTube:
 *   · Las entradas `unavailable` **se enseñan marcadas** (lo pide la issue). El
 *     frontal las descarta; aquí no se descartan.
 *   · El filtro `status != 'llm_guess'` sí se mantiene, pero se aplica **en el
 *     cliente**: en PostgREST `neq` descarta también los NULL, y una fila sin
 *     `status` es un segmento legítimo, no una adivinanza.
 *
 * Las variables son **opcionales a propósito**: sin ellas la lista de ensayo
 * funciona sin vídeos (mapa vacío y un aviso por consola, una sola vez).
 */

/** Un tramo reproducible de una tune. */
export interface TuneSegment {
  /** `tune_id` de TradTube como texto, que es lo que compara `pr_tunes.origin_ref`. */
  originRef: string;
  mediaId: string;
  title: string | null;
  youtubeId: string;
  startSec: number;
  /** null cuando el segmento no tiene fin declarado: el iframe debe OMITIR `end`. */
  endSec: number | null;
  position: number;
  unavailable: boolean;
}

/** Lo que se pide a PostgREST. `status` viaja para poder filtrar `llm_guess` en casa. */
const SEGMENT_SELECT =
  'tune_id,start_sec,end_sec,position,media:tune_media!inner(id,title,media_uri,hidden,unavailable,status)';

/** Filas por petición. La lista del día son 8 tunes, pero el tope no debe depender de eso. */
export const SEGMENT_BATCH_SIZE = 100;

/** Un id de YouTube son 11 caracteres de este alfabeto. Cortos o largos no son ids. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Un `tune_id` de TradTube es un entero: lo demás no puede tener segmentos. */
const TUNE_ID = /^\d+$/;

/** La marca de una fila adivinada por el modelo, aún sin revisar. */
const LLM_GUESS_STATUS = 'llm_guess';

/**
 * La petición no se pudo hacer o no se pudo entender. La pantalla la trata como
 * «esta lista va sin vídeo», no como un error de la lista de ensayo.
 */
export class TradtubeUnavailableError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'TradtubeUnavailableError';
    this.status = status;
  }
}

/**
 * Caché por sesión: `originRef` → sus segmentos. **Incluye las respuestas
 * vacías** (una tune sin vídeo no se vuelve a pedir), pero un fallo de red no se
 * cachea: el siguiente intento vuelve a preguntar.
 */
const segmentCache = new Map<string, TuneSegment[]>();

/** Sin configurar, se avisa **una vez**: la lista de ensayo no debe llenar la consola. */
let warnedMissingConfig = false;

/** Vacía la caché en memoria (solo para tests). */
export function clearSegmentCache(): void {
  segmentCache.clear();
  warnedMissingConfig = false;
}

// ── puro ────────────────────────────────────────────────────────────

/**
 * El id de YouTube de una `media_uri`, o `null` si no hay uno utilizable.
 * Acepta `watch?v=X`, `youtu.be/X` y las formas `embed`/`shorts`, con `&t=…` o
 * `&list=…` pegados detrás: los parámetros de más se ignoran.
 */
export function youtubeIdFromUri(uri: string): string | null {
  const raw = typeof uri === 'string' ? uri.trim() : '';
  if (raw.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    candidate = parsed.searchParams.get('v');
    if (!candidate) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const kind = parts[0] ?? '';
      if (kind === 'embed' || kind === 'shorts' || kind === 'v') candidate = parts[1] ?? null;
    }
  } else {
    return null;
  }

  if (!candidate) return null;
  return YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** La miniatura de 320 × 180 que sirve YouTube. No hay columna de miniatura en TradTube. */
export function thumbnailUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`;
}

/**
 * La URL del reproductor incrustado. `end` **solo** aparece cuando el segmento
 * declara fin: `end=null` rompería el iframe.
 *
 * No lleva `autoplay`: eso lo añade quien pinta el iframe al pulsar, porque el
 * clic es la petición del usuario (nada suena al abrir la página).
 */
export function embedUrl(segment: TuneSegment): string {
  const start = Number.isFinite(segment.startSec) ? Math.max(0, Math.floor(segment.startSec)) : 0;
  const base = `https://www.youtube-nocookie.com/embed/${segment.youtubeId}?start=${start}`;
  if (segment.endSec === null || segment.endSec === undefined) return base;
  if (!Number.isFinite(segment.endSec)) return base;
  const end = Math.max(start, Math.floor(segment.endSec));
  return `${base}&end=${end}`;
}

/** Orden dentro de una tune: `position`, después `startSec`, después `mediaId`. */
function compareSegments(a: TuneSegment, b: TuneSegment): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.startSec !== b.startSec) return a.startSec - b.startSec;
  // Comparación por code unit, no `localeCompare`: el orden no puede depender
  // de la ICU del runtime (misma regla que el resto de comparadores del repo).
  if (a.mediaId === b.mediaId) return 0;
  return a.mediaId < b.mediaId ? -1 : 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Un número, o `null` si de verdad no lo es (no se inventa un 0 donde falta el dato). */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** PostgREST devuelve el recurso embebido como objeto; se tolera también un array. */
function embeddedRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

/**
 * Filas de PostgREST → segmentos. Tolerante a propósito: lo que no tiene media
 * utilizable se cae en silencio, porque una fila rota no puede tumbar la lista
 * de ensayo entera.
 *
 * Descarta: la fila sin `media`, el `media_uri` sin id de YouTube, la oculta, la
 * adivinanza sin revisar (`status = 'llm_guess'`) y la fila sin `tune_id`.
 * Respeta: `end_sec` nulo (se queda nulo) y `unavailable` (se queda marcada).
 */
export function parseSegmentRows(rows: unknown): TuneSegment[] {
  if (!Array.isArray(rows)) return [];

  const segments: TuneSegment[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;

    const media = embeddedRecord(record.media);
    if (!media) continue;

    const rawTuneId = asNumber(record.tune_id);
    if (rawTuneId === null) continue;

    const mediaId = asText(media.id);
    if (!mediaId) continue;

    const uri = asText(media.media_uri);
    if (!uri) continue;
    const youtubeId = youtubeIdFromUri(uri);
    if (!youtubeId) continue;

    // El filtro `hidden=false` viaja en la petición; esto es el cinturón por si
    // alguna vez se pide sin él.
    if (media.hidden === true) continue;

    // Adivinanzas sin revisar: mismo filtro que el frontal de TradTube.
    const status = asText(media.status);
    if (status !== null && status.toLowerCase() === LLM_GUESS_STATUS) continue;

    const startSec = asNumber(record.start_sec) ?? 0;
    const endSec = asNumber(record.end_sec);

    segments.push({
      originRef: String(rawTuneId),
      mediaId,
      title: asText(media.title),
      youtubeId,
      startSec,
      endSec,
      position: asNumber(record.position) ?? 0,
      unavailable: media.unavailable === true,
    });
  }

  // Ordenar aquí deja el invariante en la función pura; agrupar no lo cambia.
  return segments.sort(compareSegments);
}

/** Los segmentos agrupados por tune, cada grupo ya ordenado. */
function groupByTune(segments: readonly TuneSegment[]): Map<string, TuneSegment[]> {
  const groups = new Map<string, TuneSegment[]>();
  for (const segment of segments) {
    const bucket = groups.get(segment.originRef);
    if (bucket) bucket.push(segment);
    else groups.set(segment.originRef, [segment]);
  }
  for (const bucket of groups.values()) bucket.sort(compareSegments);
  return groups;
}

// ── red ─────────────────────────────────────────────────────────────

interface TradtubeConfig {
  base: string;
  anon: string;
}

/**
 * La configuración, leída **en cada llamada** (no al importar): así los tests
 * pueden simular el «sin configurar» y un despliegue sin estas variables no
 * rompe el arranque del módulo.
 *
 * El respaldo por `globalThis.process.env` existe para la suite y para los
 * scripts: en el navegador no hay `process` y el valor sale solo de Vite.
 */
function readConfig(): TradtubeConfig | null {
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const pick = (name: 'VITE_TRADTUBE_URL' | 'VITE_TRADTUBE_ANON'): string => {
    const fromVite = (import.meta.env as Record<string, string | undefined>)[name];
    if (typeof fromVite === 'string' && fromVite.trim().length > 0) return fromVite.trim();
    const fromNode = nodeEnv?.[name];
    return typeof fromNode === 'string' ? fromNode.trim() : '';
  };

  const base = pick('VITE_TRADTUBE_URL').replace(/\/+$/, '');
  const anon = pick('VITE_TRADTUBE_ANON');
  if (base.length === 0 || anon.length === 0) return null;
  return { base, anon };
}

/** Una petición (una tanda). Lanza `TradtubeUnavailableError` si no se puede leer. */
async function requestSegments(
  config: TradtubeConfig,
  refs: readonly string[]
): Promise<TuneSegment[]> {
  // La query se compone a mano —sin `URLSearchParams`— para que viaje tal y como
  // está medida contra el servicio: `tune_id=in.(67,1,2)` con los paréntesis y
  // las comas literales. PostgREST los acepta así y el registro del bug es legible.
  const url =
    `${config.base}/rest/v1/tune_media_entries` +
    `?select=${SEGMENT_SELECT}` +
    `&tune_id=in.(${refs.join(',')})` +
    `&tune_media.hidden=eq.false` +
    `&order=tune_id.asc,position.asc`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        apikey: config.anon,
        Authorization: `Bearer ${config.anon}`,
        Accept: 'application/json',
      },
    });
  } catch (cause) {
    throw new TradtubeUnavailableError(
      `Could not reach TradTube: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }

  if (!response.ok) {
    throw new TradtubeUnavailableError(`TradTube responded ${response.status}.`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TradtubeUnavailableError('TradTube returned a body that is not JSON.', response.status);
  }

  return parseSegmentRows(payload);
}

/** Deduplica y normaliza, conservando el orden de entrada. */
function normalizeRefs(refs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    const value = typeof ref === 'string' ? ref.trim() : String(ref ?? '').trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Los segmentos de esas tunes, **en una sola petición** (tandas de 100 por si la
 * lista crece). Devuelve solo las claves con segmentos: una tune sin vídeo no
 * aparece en el mapa.
 *
 * Cachea en memoria por sesión, incluidas las respuestas vacías; un fallo de red
 * **no** se cachea, así que el siguiente intento vuelve a preguntar.
 *
 * Sin `VITE_TRADTUBE_URL`/`VITE_TRADTUBE_ANON` devuelve un mapa vacío y avisa una
 * sola vez por consola: los vídeos son un adorno de la lista de ensayo, no un
 * requisito para ensayar (y por eso tampoco son una exigencia del guard de build).
 */
export async function fetchSegments(
  originRefs: readonly string[]
): Promise<Map<string, TuneSegment[]>> {
  const wanted = normalizeRefs(originRefs);
  const result = new Map<string, TuneSegment[]>();
  if (wanted.length === 0) return result;

  const missing = wanted.filter((ref) => !segmentCache.has(ref));

  // Lo que no es un `tune_id` numérico no puede tener segmentos en TradTube: se
  // cachea vacío para no volver a mirarlo y no se manda (rompería el `in.(…)`).
  const numeric: string[] = [];
  for (const ref of missing) {
    if (TUNE_ID.test(ref)) numeric.push(ref);
    else segmentCache.set(ref, []);
  }

  if (numeric.length > 0) {
    const config = readConfig();
    if (!config) {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        console.warn(
          '[tradtube] VITE_TRADTUBE_URL / VITE_TRADTUBE_ANON are not set — the practice list runs without videos.'
        );
      }
      // No se cachea nada: sin configuración no hay respuesta que recordar, y si
      // aparece un build con las variables, la siguiente llamada pregunta.
    } else {
      for (let index = 0; index < numeric.length; index += SEGMENT_BATCH_SIZE) {
        const batch = numeric.slice(index, index + SEGMENT_BATCH_SIZE);
        const groups = groupByTune(await requestSegments(config, batch));
        // Una respuesta vacía también se cachea: la tune que no tiene vídeo no se
        // vuelve a pedir en cada recarga de la lista.
        for (const ref of batch) segmentCache.set(ref, groups.get(ref) ?? []);
      }
    }
  }

  for (const ref of wanted) {
    const bucket = segmentCache.get(ref);
    // Copia: el mapa que se devuelve no puede mutar la caché de la sesión.
    if (bucket && bucket.length > 0) result.set(ref, [...bucket]);
  }

  return result;
}
