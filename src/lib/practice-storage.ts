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
  /**
   * Tope del banco de trabajo (#52): cuántas tunes caben a la vez en
   * `learning`. Es un límite WIP, no un contador: con ciento noventa y dos
   * entradas no hay rotación, hay cola. Vive aquí —y no en una constante— para
   * poder ajustarlo sin desplegar; el valor por defecto es el ~6 que ya declara
   * el reparto tipo de la spec.
   */
  learningSlots: number;
}

export const DEFAULT_PREFS: PracticePrefs = { instrument: 'fiddle', dailyTarget: 8, learningSlots: 6 };

export const DAILY_TARGET_MIN = 1;
export const DAILY_TARGET_MAX = 20;
export const LEARNING_SLOTS_MIN = 1;
export const LEARNING_SLOTS_MAX = 20;

/** Lo que necesita el módulo de un almacenamiento: `window.localStorage` encaja sin adaptador. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Claves literales de almacenamiento. No cambiar: hay datos de usuarios ahí fuera. */
const PREFS_KEY = 'tt-practice-prefs';
const RECENT_KEY = 'tt-practice-recent';
const PLAN_KEY = 'tt-practice-plan';
/** Clave anterior (lista congelada **por fecha**). Solo se lee para migrarla. */
const LEGACY_TODAY_KEY = 'tt-practice-today';

/** Máximo de listas recientes que se conservan. */
export const RECENT_LIMIT = 3;

export interface RecentList {
  /** Fecha local `YYYY-MM-DD`. */
  date: string;
  ids: string[];
}

/**
 * La lista de ensayo viva: **inmutable** hasta que el usuario pida otra.
 *
 * No lleva fecha de calendario a propósito. Antes se congelaba «la de hoy» y la
 * vista reanudaba «la última sesión abierta de hoy»; cualquier recarga en un mal
 * momento abría una sesión nueva y las marcas se repartían en fragmentos de una
 * línea. Desde #56 la unidad de práctica es la tune **y el día**, así que la
 * lista no lleva identidad de sesión: lo marcado se pregunta por día
 * (`pr_practice`, único por `user_id, repertoire_id, day`) y el `unique` hace el
 * trabajo que antes hacía la identidad de sesión guardada aquí.
 */
export interface PracticePlan {
  /** Instante de generación (ms epoch): fecha la cabecera y siembra la lista. */
  createdAt: number;
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
  return normalizeCount(value, DEFAULT_PREFS.dailyTarget, DAILY_TARGET_MIN, DAILY_TARGET_MAX);
}

/**
 * Entero acotado a `[min, max]`; cualquier otra cosa (cadena incluida) cae al
 * valor por defecto: preferimos un número razonable antes que adivinar.
 */
function normalizeCount(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number') return fallback;
  const rounded = Math.round(value);
  const clamped = Math.min(max, Math.max(min, rounded));
  return Number.isFinite(clamped) ? clamped : fallback;
}

/** Tope del banco de trabajo (#52), acotado igual que el objetivo diario. */
function normalizeLearningSlots(value: unknown): number {
  return normalizeCount(value, DEFAULT_PREFS.learningSlots, LEARNING_SLOTS_MIN, LEARNING_SLOTS_MAX);
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
    learningSlots: normalizeLearningSlots(raw.learningSlots),
  };
}

function compareRecent(a: RecentList, b: RecentList): number {
  if (a.date === b.date) return 0;
  return a.date < b.date ? 1 : -1;
}

/** `createdAt` válido: instante positivo y finito; cualquier otra cosa es 0 (inválido). */
function normalizeCreatedAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
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
// Lista de ensayo viva (caché revocable a mano)
// ---------------------------------------------------------------------------

/**
 * La lista viva, o `null` si no hay ninguna utilizable.
 *
 * Se lee sin mirar el calendario: una lista generada anteayer sigue siendo la
 * lista hasta que el usuario pida otra. Eso es justo lo que la hace inmutable —
 * recargar, navegar a The Session y volver no la toca.
 *
 * **Migración (2026-11-05):** si no hay plan, se adopta la lista congelada de
 * clave `tt-practice-today`, pero **solo si es de hoy**; una de ayer muere
 * como moría antes. Al adoptarla se borra la clave vieja, para que «New list» no
 * la resucite en la siguiente lectura. Desde #56 no hay identidad de sesión que
 * heredar: las marcas se preguntan por día, así que adoptar una lista vieja no
 * arrastra nada.
 */
export function readPlan(store: KeyValueStore, nowMs: number): PracticePlan | null {
  const stored = parseStored(store, PLAN_KEY);
  if (isRecord(stored)) {
    const ids = readIds(stored.ids);
    const createdAt = normalizeCreatedAt(stored.createdAt);
    if (ids !== null && createdAt !== 0) {
      return {
        createdAt,
        ids,
        overflow: normalizeOverflow(stored.overflow),
      };
    }
  }

  const legacy = parseStored(store, LEGACY_TODAY_KEY);
  if (!isRecord(legacy) || legacy.date !== todayKeyFor(nowMs)) return null;
  const legacyIds = readIds(legacy.ids);
  if (legacyIds === null) return null;

  try {
    store.removeItem(LEGACY_TODAY_KEY);
  } catch {
    /* almacenamiento bloqueado: la clave vieja se queda, pero no estorba */
  }

  return {
    createdAt: startOfLocalDay(nowMs),
    ids: legacyIds,
    overflow: normalizeOverflow(legacy.overflow),
  };
}

/**
 * Guarda la lista viva. `createdAt` tiene que ser un instante válido: sin él la
 * lista no se podría ni fechar ni sembrar, y una lista sin fecha de generación
 * es una lista que miente. Falla en voz alta en vez de escribir basura.
 */
export function writePlan(store: KeyValueStore, plan: PracticePlan): void {
  const createdAt = normalizeCreatedAt(plan.createdAt);
  if (createdAt === 0) {
    throw new Error('A practice plan needs a valid createdAt.');
  }

  const value: PracticePlan = {
    createdAt,
    ids: [...plan.ids],
    overflow: normalizeOverflow(plan.overflow),
  };
  store.setItem(PLAN_KEY, JSON.stringify(value));

  try {
    store.removeItem(LEGACY_TODAY_KEY);
  } catch {
    /* almacenamiento bloqueado */
  }
}

/** Revoca la lista viva: la próxima carga generará una nueva. */
export function clearPlan(store: KeyValueStore): void {
  store.removeItem(PLAN_KEY);
  try {
    store.removeItem(LEGACY_TODAY_KEY);
  } catch {
    /* almacenamiento bloqueado */
  }
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

/**
 * Instante del inicio del día **local** que contiene `nowMs`.
 *
 * Es la frontera del día local: el rango del historial y la adopción de una
 * lista vieja se cuentan desde aquí. Se compone con los setters locales por lo
 * mismo que `todayKeyFor`: medianoche local, no UTC. `setHours` sobre la fecha
 * local resuelve además los días de cambio de hora sin cuentas de 86 400 000 ms.
 */
export function startOfLocalDay(nowMs: number): number {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
