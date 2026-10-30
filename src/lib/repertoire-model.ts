import { daysSince, normalizeTitle } from './format';

/**
 * Modelo puro del repertorio: tipos, normalización de la fila que devuelve
 * PostgREST y presentación. Sin cliente Supabase, para poder probarlo sin red.
 */

export type TuneStatus = 'nueva' | 'aprendiendo' | 'media' | 'afianzada' | 'aparcada';

export interface TuneRecord {
  id: string;
  origin: string;
  origin_ref: string | null;
  name: string;
  rhythm: string | null;
  meter: string | null;
  key: string | null;
  abc: string | null;
}

/**
 * Fondo elegido para la tune (issue #31). Vive en la fila del repertorio, no en
 * una tabla aparte: dos usuarios pueden querer imágenes distintas para la misma
 * tune. `null` cuando no hay fondo, y entonces la carta se pinta como antes.
 */
export interface ChosenImage {
  source: 'commons' | 'pexels' | 'upload';
  id: string | null;
  thumbUrl: string | null;
  fullUrl: string | null;
  pageUrl: string | null;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Punto focal en % y zoom 1–2,2: el encuadre manual sobre el recorte 5:4. */
  focalX: number;
  focalY: number;
  zoom: number;
  chosenAt: string | null;
}

export interface RepertoireRow {
  id: string;
  status: TuneStatus;
  rating: number | null;
  custom_title: string | null;
  custom_rhythm: string | null;
  custom_key: string | null;
  notes: string | null;
  added_at: string;
  last_practiced_at: string | null;
  tune: TuneRecord;
  /** Fondo elegido; null si la tune no tiene imagen todavía. */
  image: ChosenImage | null;
}

/** Los valores por defecto son los de la migración 005: centro y 100 %. */
const IMAGE_FOCAL_DEFAULT = 50;
const IMAGE_ZOOM_DEFAULT = 1;

function clampFocalValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IMAGE_FOCAL_DEFAULT;
  return Math.min(100, Math.max(0, parsed));
}

function clampZoomValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IMAGE_ZOOM_DEFAULT;
  return Math.min(2.2, Math.max(1, parsed));
}

/**
 * Normaliza las doce columnas de imagen de una fila de PostgREST. Sin
 * `image_thumb_url` no hay fondo que pintar: se devuelve null y la carta queda
 * como estaba (la imagen elegida puede haber quedado sin URL por un borrado
 * manual en la base, y eso no debe romper la rejilla).
 */
export function mapImageRow(row: Record<string, any>): ChosenImage | null {
  const source = row.image_source;
  if (source !== 'commons' && source !== 'pexels' && source !== 'upload') return null;
  if (!row.image_thumb_url) return null;

  return {
    source,
    id: row.image_id ?? null,
    thumbUrl: row.image_thumb_url,
    fullUrl: row.image_full_url ?? row.image_thumb_url,
    pageUrl: row.image_page_url ?? null,
    author: row.image_author ?? null,
    license: row.image_license ?? null,
    licenseUrl: row.image_license_url ?? null,
    focalX: clampFocalValue(row.image_focal_x),
    focalY: clampFocalValue(row.image_focal_y),
    zoom: clampZoomValue(row.image_zoom),
    chosenAt: row.image_chosen_at ?? null,
  };
}

/**
 * PostgREST devuelve la relación embebida como objeto (many-to-one) o como array
 * según la forma del join; aquí se normaliza a un único TuneRecord.
 */
export function mapRepertoireRow(row: Record<string, any>): RepertoireRow {
  const embedded = Array.isArray(row.pr_tunes) ? row.pr_tunes[0] : row.pr_tunes;
  if (!embedded) {
    throw new Error(`Repertoire row ${row.id} came back without its tune.`);
  }
  return {
    id: row.id,
    status: row.status as TuneStatus,
    rating: row.rating ?? null,
    custom_title: row.custom_title ?? null,
    custom_rhythm: row.custom_rhythm ?? null,
    custom_key: row.custom_key ?? null,
    notes: row.notes ?? null,
    added_at: row.added_at,
    last_practiced_at: row.last_practiced_at ?? null,
    tune: embedded as TuneRecord,
    image: mapImageRow(row),
  };
}

export function displayTitle(item: RepertoireRow): string {
  return item.custom_title?.trim() || normalizeTitle(item.tune.name);
}

/**
 * Crédito del fondo, tal y como se pinta en el detalle: «autor · licencia».
 * La licencia de Commons llega a veces vacía; entonces se enseña solo el autor.
 * El enlace a la ficha lo pone la vista con `image.pageUrl`.
 */
export function imageCredit(image: ChosenImage | null): string {
  if (!image) return '';
  const author = (image.author ?? '').trim() || 'Unknown author';
  const license = (image.license ?? '').trim();
  return license ? `${author} · ${license}` : author;
}

export function displayRhythm(item: RepertoireRow): string {
  return item.custom_rhythm?.trim() || item.tune.rhythm || '—';
}

export function displayKey(item: RepertoireRow): string {
  return item.custom_key?.trim() || item.tune.key || '—';
}

export const STATUS_LABELS: Record<TuneStatus, string> = {
  nueva: 'New',
  aprendiendo: 'Learning',
  media: 'Fluent',
  afianzada: 'Solid',
  aparcada: 'Shelved',
};

export const STATUS_STYLES: Record<TuneStatus, string> = {
  nueva: 'bg-sky-900/60 text-sky-300 border-sky-700',
  aprendiendo: 'bg-amber-900/60 text-amber-300 border-amber-700',
  media: 'bg-violet-900/60 text-violet-300 border-violet-700',
  afianzada: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
  aparcada: 'bg-gray-800 text-gray-400 border-gray-600',
};

/**
 * Recencia del último ensayo (#7, corte 2). La card enseñaba la fecha; para
 * decidir qué ensayar lo útil son los días. Se calcula sobre el instante `now`
 * de la vista para que el resultado sea determinista en los tests.
 */
export interface PracticeRecency {
  /** Días enteros desde el último ensayo; null si nunca se ensayó. */
  days: number | null;
  /** Texto listo para pintar (en inglés, como el resto de la UI). */
  label: string;
}

export function practiceRecency(row: RepertoireRow, now: number): PracticeRecency {
  const days = daysSince(row.last_practiced_at, now);
  if (days === null) return { days: null, label: 'Never practiced' };
  if (days === 0) return { days, label: 'Practiced today' };
  if (days === 1) return { days, label: '1 day ago' };
  return { days, label: `${days} days ago` };
}

/**
 * Iniciales del título mostrado para el cuadro mnemotécnico de la card, máximo
 * dos y en mayúsculas. Se toma la primera letra de cada palabra: «Kesh, The» se
 * muestra como «The Kesh», así que da «TK». Sin letras en el título, «?».
 */
export function placeholderInitials(row: RepertoireRow): string {
  const words = displayTitle(row).split(/\s+/);
  const initials: string[] = [];
  for (const word of words) {
    const letter = word.match(/\p{L}/u);
    if (!letter) continue;
    initials.push(letter[0]);
    if (initials.length === 2) break;
  }
  return initials.length > 0 ? initials.join('').toUpperCase() : '?';
}

/** Campos cuyo valor viene de un override personal y no del tune compartido. */
export interface OverrideFields {
  title: boolean;
  rhythm: boolean;
  key: boolean;
}

/** Un override cuenta solo si tiene texto: un `custom_key` vacío no lo es. */
function hasText(value: string | null): boolean {
  return (value ?? '').trim().length > 0;
}

/**
 * Marca de overrides (F2): el detalle enseña de dónde sale cada valor. La card
 * no los marca; este corte solo los distingue en `/repertoire/:id`.
 */
export function overrideFields(row: RepertoireRow): OverrideFields {
  return {
    title: hasText(row.custom_title),
    rhythm: hasText(row.custom_rhythm),
    key: hasText(row.custom_key),
  };
}

/**
 * Clave del orden alfabético: minúsculas y sin diacríticos. Se compara por code
 * unit (sin localeCompare): la ICU del navegador sería un resultado no
 * determinista entre entornos. «Ángel» y «Oro» se comparan como «angel»/«oro».
 */
export function collationKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

export type SortKey = 'urgency' | 'alphabetical' | 'added' | 'rating';

/** Etiquetas del selector de orden, para ambas vistas. */
export const SORT_LABELS: Record<SortKey, string> = {
  urgency: 'Urgency',
  alphabetical: 'A to Z',
  added: 'Recently added',
  rating: 'Rating',
};

/** Comparación de cadenas por code unit: -1, 0 o 1. Determinista en cualquier runtime. */
function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Desempate común de todos los criterios: título mostrado y, en última
 * instancia, el id de la fila. Dos filas con la misma clave quedan siempre en
 * el mismo orden relativo, sea cual sea el orden en que lleguen.
 */
function tieBreak(left: RepertoireRow, right: RepertoireRow): number {
  const byTitle = compareStrings(
    collationKey(displayTitle(left)),
    collationKey(displayTitle(right))
  );
  if (byTitle !== 0) return byTitle;
  return compareStrings(left.id, right.id);
}

/** Último ensayo como instante; null si nunca se ensayó o la fecha es inválida. */
function practiceTime(row: RepertoireRow): number | null {
  if (row.last_practiced_at === null) return null;
  const time = new Date(row.last_practiced_at).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Fecha de alta como instante; 0 si la fecha es inválida. */
function addedTime(row: RepertoireRow): number {
  const time = new Date(row.added_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

const SORT_COMPARATORS: Record<SortKey, (left: RepertoireRow, right: RepertoireRow) => number> = {
  /**
   * Urgencia: primero los nunca ensayados; después los más antiguos de
   * `last_practiced_at` primero (más días sin practicar). Los nunca ensayados
   * no se ordenan entre sí por fecha: no tienen ninguna, quedan juntos y los
   * desempata el título.
   */
  urgency: (left, right) => {
    const leftTime = practiceTime(left);
    const rightTime = practiceTime(right);
    if (leftTime === null || rightTime === null) {
      if (leftTime === rightTime) return tieBreak(left, right);
      return leftTime === null ? -1 : 1;
    }
    if (leftTime !== rightTime) return leftTime - rightTime;
    return tieBreak(left, right);
  },
  /** Alfabético por `displayTitle`, sin distinguir mayúsculas ni acentos. */
  alphabetical: (left, right) => tieBreak(left, right),
  /** Fecha de alta: la más reciente primero, como ordena ya la consulta. */
  added: (left, right) => {
    const leftTime = addedTime(left);
    const rightTime = addedTime(right);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return tieBreak(left, right);
  },
  /** Rating descendente; los null van al final. */
  rating: (left, right) => {
    const leftRating = left.rating ?? Number.NEGATIVE_INFINITY;
    const rightRating = right.rating ?? Number.NEGATIVE_INFINITY;
    if (leftRating !== rightRating) return rightRating - leftRating;
    return tieBreak(left, right);
  },
};

/**
 * Devuelve una copia ordenada, sin mutar la de entrada. El comparador lleva
 * desempate propio, así que el resultado no depende del orden de la consulta.
 */
export function sortRepertoire(rows: readonly RepertoireRow[], key: SortKey): RepertoireRow[] {
  return [...rows].sort(SORT_COMPARATORS[key]);
}

/** Modo de presentación del repertorio: la tabla clásica o las tarjetas. */
export type ViewMode = 'table' | 'grid';

/** Clave en `sessionStorage`: vive en la pestaña, sin tocar la base de datos. */
export const VIEW_MODE_KEY = 'tradtracker.repertoire-view';

/**
 * Tolerante a basura en el almacenamiento: solo «table» opta por la tabla. La
 * vista por defecto es el grid de tarjetas, como pide la issue #7.
 */
export function parseViewMode(raw: string | null): ViewMode {
  return raw === 'table' ? 'table' : 'grid';
}
