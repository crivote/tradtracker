/**
 * Importación del tunebook de thesession.org (issue #32): parseo y plan.
 *
 * Módulo PURO a propósito: sin red, sin Supabase y sin SQLite. Aquí se traduce
 * lo que devuelve el API a las filas que esperan `pr_tunes` y `pr_repertoire`;
 * el `fetch` vive en `thesession-api.ts` y el enganche a la base de datos es
 * cosa del corte 2.
 *
 * Dos hechos del API mandan sobre el diseño:
 *   · Cada tune del listado trae **solo** `id, name, url, date, type, added`.
 *     No hay `key` ni `meter`: el compás se rellena del catálogo local.
 *   · `perpage`, `page` y `total` llegan como texto O como número según cómo se
 *     pida, así que el parseo no puede asumir un tipo.
 */

export interface SessionTune {
  tuneId: number;
  name: string;
  rhythm: string | null;
  addedAt: string | null;
}

export interface SessionTunebookPage {
  page: number;
  pages: number;
  total: number;
  tunes: SessionTune[];
}

export interface SessionMember {
  id: number;
  name: string;
  bio: string | null;
}

/** Tamaño de página que se pide al API (el máximo que admite). */
export const SESSION_PER_PAGE = 50;

/** Techo de páginas: 40 × 50 = 2.000 tunes. Por encima se aborta. */
export const SESSION_MAX_PAGES = 40;

/** Fecha del API: `2022-11-16 17:58:44`, a veces sin hora y a veces vacía. */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/;

/** Ficha de miembro o su tunebook, con id numérico. */
const MEMBER_URL = /(?:^|\/)members\/(\d+)(?:[/?#]|$)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Acepta número o texto numérico; cualquier otra cosa cae al valor por defecto. */
function toCount(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Texto limpio o `null`: el API usa `''` donde el esquema quiere ausencia. */
function toTextOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `2022-11-16 17:58:44` → `2022-11-16T17:58:44Z`.
 *
 * Se compone la cadena a mano en vez de fiarse de `Date`: `toISOString()` mete
 * milisegundos (`.000`) y el esquema no los quiere, y una fecha imposible tiene
 * que salir `null`, no un `Invalid Date` que reviente más tarde al insertar.
 */
function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const millis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (Number.isNaN(millis)) return null;

  // Un 31 de febrero lo «arregla» el motor moviéndolo a marzo: si los campos no
  // vuelven igual, la fecha no existía y se descarta.
  const parsed = new Date(millis);
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

function toSessionTune(value: unknown): SessionTune | null {
  const record = asRecord(value);
  if (!record) return null;

  const tuneId = toCount(record.id, 0);
  // Sin id no hay `origin_ref` posible: la fila no se podría ni deduplicar.
  if (!Number.isInteger(tuneId) || tuneId <= 0) return null;

  const name = toTextOrNull(record.name);
  // El nombre es `not null` en `pr_tunes`: sin él, el tune no entra.
  if (!name) return null;

  return {
    tuneId,
    name,
    rhythm: toTextOrNull(record.type),
    addedAt: toIsoTimestamp(record.added),
  };
}

/**
 * Una página del tunebook. Los tunes sin nombre (o sin id) se descartan aquí,
 * así que `tunes.length` puede ser menor que lo que trajo el API.
 */
export function parseTunebookPage(payload: unknown): SessionTunebookPage {
  const record = asRecord(payload);
  if (!record) {
    throw new Error('The Session tunebook response is not an object.');
  }
  if (!Array.isArray(record.tunes)) {
    throw new Error('The Session tunebook response has no "tunes" list.');
  }

  const tunes: SessionTune[] = [];
  for (const entry of record.tunes) {
    const tune = toSessionTune(entry);
    if (tune) tunes.push(tune);
  }

  return {
    page: toCount(record.page, 1),
    pages: toCount(record.pages, 1),
    total: toCount(record.total, tunes.length),
    tunes,
  };
}

/** Resultados de `/members/search`. Un miembro sin id o sin nombre no sirve. */
export function parseMemberSearch(payload: unknown): SessionMember[] {
  const record = asRecord(payload);
  const entries = record && Array.isArray(record.members) ? record.members : [];

  const members: SessionMember[] = [];
  for (const entry of entries) {
    const row = asRecord(entry);
    if (!row) continue;

    const id = toCount(row.id, 0);
    const name = toTextOrNull(row.name);
    if (!Number.isInteger(id) || id <= 0 || !name) continue;

    members.push({ id, name, bio: toTextOrNull(row.bio) });
  }
  return members;
}

/**
 * Id de miembro a partir de lo que pegue el usuario: el número pelado, la URL
 * de su ficha, la de su tunebook o `members/99727`.
 *
 * Buscar por nombre de usuario NO resuelve la ficha (`/members/<nombre>/…` da
 * 404), así que un texto sin id tiene que devolver `null` para que la pantalla
 * ofrezca el buscador en vez de pedir una URL condenada.
 */
export function parseMemberId(input: string): number | null {
  const raw = (input ?? '').trim();
  if (raw === '') return null;

  const match = /^\d+$/.test(raw) ? [raw, raw] : MEMBER_URL.exec(raw);
  if (!match) return null;

  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

/** Un tune puede venir repetido entre páginas: gana la primera aparición. */
export function dedupeTunebook(tunes: SessionTune[]): SessionTune[] {
  const seen = new Set<number>();
  const unique: SessionTune[] = [];
  for (const tune of tunes) {
    if (seen.has(tune.tuneId)) continue;
    seen.add(tune.tuneId);
    unique.push(tune);
  }
  return unique;
}

/**
 * Qué añadir y qué ya estaba. `existingRefs` son los `origin_ref` ya guardados
 * en `pr_tunes` (la columna es `text`, así que se comparan como texto).
 */
export function importPlan(
  tunes: SessionTune[],
  existingRefs: Iterable<string>
): { toAdd: SessionTune[]; alreadyPresent: SessionTune[] } {
  const existing = new Set<string>();
  for (const ref of existingRefs) existing.add(ref);

  const toAdd: SessionTune[] = [];
  const alreadyPresent: SessionTune[] = [];
  for (const tune of tunes) {
    if (existing.has(String(tune.tuneId))) alreadyPresent.push(tune);
    else toAdd.push(tune);
  }
  return { toAdd, alreadyPresent };
}

/** Fila de `pr_tunes`. `created_by` lo pone el llamador: lo exige la RLS. */
export interface TuneInsertRow {
  origin: 'thesession';
  origin_ref: string;
  name: string;
  rhythm: string | null;
  meter: string | null;
}

/** Fila de `pr_repertoire`. `added_at` solo viaja si hay fecha. */
export interface RepertoireInsertRow {
  tune_id: string;
  status: string;
  added_at?: string;
}

/**
 * Filas de `pr_tunes` con el compás del catálogo local. Un id que no esté en el
 * mapa deja `meter: null` —el tune se importa igual, el compás se puede
 * completar luego— en vez de romper la tanda entera.
 */
export function tuneRowsFor(
  tunes: SessionTune[],
  meterById: Map<number, string | null>
): TuneInsertRow[] {
  return tunes.map((tune) => ({
    origin: 'thesession',
    origin_ref: String(tune.tuneId),
    name: tune.name,
    rhythm: tune.rhythm,
    meter: meterById.get(tune.tuneId) ?? null,
  }));
}

/**
 * Filas de `pr_repertoire` cruzando el `origin_ref` con el uuid que devolvió el
 * alta. Si falta el uuid, la fila se omite: inventarlo rompería la clave ajena.
 *
 * `added_at` **no** se incluye cuando la fecha no existe: una clave con `null`
 * anula el `default now()` de la tabla y la insertarían con `not null`.
 */
export function repertoireRowsFor(
  tunes: SessionTune[],
  tuneIdByRef: Map<string, string>,
  status: string
): RepertoireInsertRow[] {
  const rows: RepertoireInsertRow[] = [];
  for (const tune of tunes) {
    const tuneId = tuneIdByRef.get(String(tune.tuneId));
    if (!tuneId) continue;

    const row: RepertoireInsertRow = { tune_id: tuneId, status };
    if (tune.addedAt !== null) row.added_at = tune.addedAt;
    rows.push(row);
  }
  return rows;
}
