/**
 * Estado de cliente de F6 (listas de ensayo): preferencias, últimas listas y
 * lista congelada del día.
 *
 * Módulo **puro**: sin `supabase`, sin red y sin DOM. El almacenamiento entra
 * por parámetro (`KeyValueStore`), así que `window.localStorage` encaja sin
 * adaptador y los tests usan un doble en memoria.
 *
 * Nada de aquí lanza por datos corruptos: una clave vieja o rota siempre cae a
 * los valores por defecto.
 */

export type PracticeInstrument = 'fiddle' | 'whistle' | 'accordion' | 'banjo';

/** Los instrumentos soportados, en el orden en que se muestran. */
export const INSTRUMENTS: readonly PracticeInstrument[] = ['fiddle', 'whistle', 'accordion', 'banjo'];

export interface PracticePrefs {
  instrument: PracticeInstrument;
  dailyTarget: number;
}

export const DEFAULT_PREFS: PracticePrefs = { instrument: 'fiddle', dailyTarget: 8 };

export const DAILY_TARGET_MIN = 1;
export const DAILY_TARGET_MAX = 20;

/** Lo que necesita el módulo de un almacenamiento: `window.localStorage` encaja sin adaptador. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Claves literales de almacenamiento. No cambiar: hay datos de usuarios ahí fuera. */
const PREFS_KEY = 'tt-practice-prefs';
const RECENT_KEY = 'tt-practice-recent';
const TODAY_KEY = 'tt-practice-today';

/** Máximo de listas recientes que se conservan. */
export const RECENT_LIMIT = 3;

export interface RecentList {
  /** Fecha local `YYYY-MM-DD`. */
  date: string;
  ids: string[];
}

export interface TodayList {
  date: string;
  ids: string[];
  /** Vencidas que no cupieron en la lista, tal y como se congeló. */
  overflow: number;
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Lee una clave sin lanzar: el almacenamiento puede no estar disponible. */
function safeGet(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/**
 * `JSON.parse` tolerante: devuelve `undefined` si la clave no existe o si el
 * contenido no es JSON válido.
 */
function parseStored(store: KeyValueStore, key: string): unknown {
  const raw = safeGet(store, key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

/** Copia de los ids que sean cadenas; `null` si el campo no es un array. */
function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((id): id is string => typeof id === 'string');
}

function isInstrument(value: unknown): value is PracticeInstrument {
  return typeof value === 'string' && (INSTRUMENTS as readonly string[]).includes(value);
}

/**
 * `dailyTarget` válido: número finito, redondeado y acotado a
 * `[DAILY_TARGET_MIN, DAILY_TARGET_MAX]`. Cualquier otra cosa (cadena incluida)
 * cae al valor por defecto: preferimos 8 antes que adivinar.
 */
function normalizeDailyTarget(value: unknown): number {
  if (typeof value !== 'number') return DEFAULT_PREFS.dailyTarget;
  const rounded = Math.round(value);
  const clamped = Math.min(DAILY_TARGET_MAX, Math.max(DAILY_TARGET_MIN, rounded));
  return Number.isFinite(clamped) ? clamped : DEFAULT_PREFS.dailyTarget;
}

/**
 * `overflow` válido: entero no negativo. Ausente, negativo, no finito o de otro
 * tipo cae a `0`; un decimal se redondea. Nunca lanza.
 */
function normalizeOverflow(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizePrefs(raw: unknown): PracticePrefs {
  if (!isRecord(raw)) return { ...DEFAULT_PREFS };
  return {
    instrument: isInstrument(raw.instrument) ? raw.instrument : DEFAULT_PREFS.instrument,
    dailyTarget: normalizeDailyTarget(raw.dailyTarget),
  };
}

function compareRecent(a: RecentList, b: RecentList): number {
  if (a.date === b.date) return 0;
  return a.date < b.date ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Preferencias
// ---------------------------------------------------------------------------

/** Preferencias guardadas; siempre devuelve las dos claves, con defaults si faltan. */
export function readPrefs(store: KeyValueStore): PracticePrefs {
  return normalizePrefs(parseStored(store, PREFS_KEY));
}

/** Guarda las preferencias, normalizadas (así una escritura mala no queda en disco). */
export function writePrefs(store: KeyValueStore, prefs: PracticePrefs): void {
  store.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(prefs)));
}

// ---------------------------------------------------------------------------
// Listas recientes
// ---------------------------------------------------------------------------

/** Últimas listas guardadas, más reciente primero, sin entradas con forma inválida. */
export function readRecentLists(store: KeyValueStore): RecentList[] {
  const raw = parseStored(store, RECENT_KEY);
  if (!Array.isArray(raw)) return [];

  const lists: RecentList[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isValidDateKey(entry.date)) continue;
    const ids = readIds(entry.ids);
    if (ids === null) continue;
    lists.push({ date: entry.date, ids });
  }

  lists.sort(compareRecent);

  // Deduplica por fecha quedándose con la primera aparición (la de fecha mayor).
  const seen = new Set<string>();
  const unique: RecentList[] = [];
  for (const list of lists) {
    if (seen.has(list.date)) continue;
    seen.add(list.date);
    unique.push(list);
  }

  return unique.slice(0, RECENT_LIMIT);
}

/** Añade la lista delante, sin duplicar por `date`, y recorta a `RECENT_LIMIT`. Devuelve lo guardado. */
export function recordRecentList(store: KeyValueStore, list: RecentList): RecentList[] {
  const entry: RecentList = { date: list.date, ids: [...list.ids] };
  const kept = readRecentLists(store).filter(existing => existing.date !== entry.date);
  const next = [entry, ...kept].sort(compareRecent).slice(0, RECENT_LIMIT);
  store.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

/**
 * Ids de la lista anterior: la más reciente almacenada cuya `date` no sea
 * `todayKey`. Conjunto vacío si no hay ninguna. Alimenta la penalización ×0,5 de D3.
 */
export function previousIds(store: KeyValueStore, todayKey: string): Set<string> {
  const previous = readRecentLists(store).find(list => list.date !== todayKey);
  return new Set(previous ? previous.ids : []);
}

// ---------------------------------------------------------------------------
// Lista congelada del día
// ---------------------------------------------------------------------------

/** La lista congelada del día, o `null` si no hay o es de otra fecha. */
export function readTodayList(store: KeyValueStore, todayKey: string): TodayList | null {
  const raw = parseStored(store, TODAY_KEY);
  if (!isRecord(raw) || raw.date !== todayKey) return null;
  const ids = readIds(raw.ids);
  if (ids === null) return null;
  return { date: todayKey, ids, overflow: normalizeOverflow(raw.overflow) };
}

/** Congela la lista del día; descarta cualquier lista congelada de otra fecha. */
export function writeTodayList(
  store: KeyValueStore,
  todayKey: string,
  ids: readonly string[],
  overflow = 0,
): void {
  const value: TodayList = {
    date: todayKey,
    ids: [...ids],
    overflow: normalizeOverflow(overflow),
  };
  store.setItem(TODAY_KEY, JSON.stringify(value));
}

export function clearTodayList(store: KeyValueStore): void {
  store.removeItem(TODAY_KEY);
}

// ---------------------------------------------------------------------------
// Fecha local
// ---------------------------------------------------------------------------

/**
 * Fecha local `YYYY-MM-DD` del instante dado. `now` se inyecta: nunca `Date.now()`
 * dentro. Se compone con los getters locales a propósito: `toISOString()` daría
 * el día siguiente a partir de las 23:00 en Madrid.
 */
export function todayKeyFor(nowMs: number): string {
  const date = new Date(nowMs);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
