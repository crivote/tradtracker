import { normalizeTitle } from './format';

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
  };
}

export function displayTitle(item: RepertoireRow): string {
  return item.custom_title?.trim() || normalizeTitle(item.tune.name);
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
