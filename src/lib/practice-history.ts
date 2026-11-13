/**
 * Historial de ensayos: lectura y modelo.
 *
 * El historial se lee **por sesiones**, que es la forma en que la base guarda la
 * práctica desde F4: una sesión con sus líneas. La pantalla lo reordena por día
 * local, porque es como se pregunta («¿qué hice el martes?»), no por sesión.
 *
 * Dos cosas que no se hacen aquí:
 *   · **No se agrega en la base.** `pr_repertoire_stats` da totales por tune, no
 *     una serie diaria; un RPC nuevo solo para una pantalla de lectura sería más
 *     superficie que la que resuelve. Se traen las sesiones del rango —son
 *     decenas, no miles— y se agrupan en memoria.
 *   · **No se inventa el día.** La clave de día se compone con los getters
 *     locales (`todayKeyFor`), nunca con `toISOString()`: en Madrid, un ensayo a
 *     las 23:30 es del día en que se tocó, no del siguiente.
 *
 * El modelo puro (`buildHistoryDays`, `historyStats`, `historySeries`) no toca la
 * red y se prueba aparte.
 */
import { supabase } from './supabase';
import { startOfLocalDay, todayKeyFor } from './practice-storage';

export const HISTORY_RANGES = [7, 30, 90] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export const DEFAULT_HISTORY_RANGE: HistoryRange = 30;

/** Un ensayo: una tune tocada dentro de una sesión. */
export interface HistoryEntry {
  repertoireId: string;
  title: string;
  rhythm: string | null;
  /** 1–5, o `null` si el ensayo se apuntó sin puntuar (es lo normal). */
  quality: number | null;
  comment: string | null;
  position: number;
}

export interface HistorySession {
  id: string;
  /** `started_at` tal y como lo devuelve la base (ISO con zona). */
  startedAt: string;
  entries: HistoryEntry[];
}

/** Un día local con lo que se ensayó en él. */
export interface HistoryDay {
  /** `YYYY-MM-DD` local. */
  key: string;
  sessions: number;
  entries: HistoryEntry[];
  practices: number;
  avgQuality: number | null;
}

export interface HistoryStats {
  practices: number;
  sessions: number;
  activeDays: number;
  /** Días consecutivos con algún ensayo, contando desde hoy (o desde ayer). */
  streak: number;
  /** Media de las valoraciones del rango; `null` si no hay ninguna. */
  avgQuality: number | null;
  ratedCount: number;
  distinctTunes: number;
  /** Reparto de valoraciones: índice 0 = una estrella. */
  distribution: number[];
}

/** Un punto de la gráfica: siempre hay uno por día del rango, con o sin ensayo. */
export interface HistoryPoint {
  key: string;
  label: string;
  practices: number;
  isToday: boolean;
}

/**
 * La consulta del historial, con el título resuelto en el mismo viaje.
 *
 * `!inner` en los dos embeds: una línea sin fila de repertorio no existe (el
 * borrado es en cascada), y un embed opcional solo añadiría nulos que habría que
 * filtrar después.
 *
 * El tope de 1.000 filas es el máximo por defecto de PostgREST y sobra para 90
 * días de una persona (el repertorio real ronda las 10 sesiones diarias). Si
 * algún día se queda corto, la gráfica sigue siendo correcta para lo cargado; lo
 * que no se hace es paginar en silencio y contar de menos sin decirlo.
 */
const HISTORY_SELECT = [
  'id',
  'started_at',
  'pr_session_tunes(quality,comment,position,repertoire_id,pr_repertoire!inner(custom_title,pr_tunes!inner(name,rhythm)))',
].join(',');

const HISTORY_LIMIT = 1000;

interface RawLine {
  quality?: unknown;
  comment?: unknown;
  position?: unknown;
  repertoire_id?: unknown;
  pr_repertoire?: {
    custom_title?: unknown;
    pr_tunes?: { name?: unknown; rhythm?: unknown } | null;
  } | null;
}

interface RawSession {
  id?: unknown;
  started_at?: unknown;
  pr_session_tunes?: RawLine[] | null;
}

export interface FetchHistoryOptions {
  /** Instante de referencia: el rango se cuenta desde su día local. */
  nowMs: number;
  /** Días hacia atrás, incluido hoy. */
  range: number;
}

/** Las sesiones del rango, más recientes primero. */
export async function fetchPracticeHistory(
  options: FetchHistoryOptions,
): Promise<HistorySession[]> {
  const { nowMs, range } = options;
  const days = Math.max(1, Math.floor(range));
  const from = startOfLocalDay(nowMs) - (days - 1) * 86_400_000;

  const { data, error } = await supabase
    .from('pr_sessions')
    .select(HISTORY_SELECT)
    .gte('started_at', new Date(from).toISOString())
    .order('started_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) throw new Error(`Could not load the practice history: ${error.message}`);

  const rows = Array.isArray(data) ? (data as RawSession[]) : [];
  const sessions: HistorySession[] = [];

  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : null;
    const startedAt = typeof row.started_at === 'string' ? row.started_at : null;
    if (!id || !startedAt) continue;

    const entries: HistoryEntry[] = [];
    for (const line of row.pr_session_tunes ?? []) {
      const repertoireId = typeof line.repertoire_id === 'string' ? line.repertoire_id : null;
      if (!repertoireId) continue;

      const tune = line.pr_repertoire?.pr_tunes ?? null;
      const custom = line.pr_repertoire?.custom_title;
      const name = typeof tune?.name === 'string' ? tune.name : '';
      const title = typeof custom === 'string' && custom.trim() ? custom : name || 'Untitled tune';

      entries.push({
        repertoireId,
        title,
        rhythm: typeof tune?.rhythm === 'string' ? tune.rhythm : null,
        quality: typeof line.quality === 'number' ? line.quality : null,
        comment: typeof line.comment === 'string' && line.comment.trim() ? line.comment : null,
        position: typeof line.position === 'number' ? line.position : 0,
      });
    }

    // Una sesión sin líneas no es un ensayo: no se pinta.
    if (entries.length === 0) continue;
    entries.sort((a, b) => a.position - b.position);
    sessions.push({ id, startedAt, entries });
  }

  return sessions;
}

/** Media con dos decimales, o `null` sin valoraciones. */
function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}

/** El día local de un instante ISO, como clave `YYYY-MM-DD`. */
export function dayKeyOf(iso: string): string {
  return todayKeyFor(new Date(iso).getTime());
}

/**
 * Las sesiones agrupadas por día local, del más reciente al más antiguo. El orden
 * dentro del día es el de las sesiones (la consulta ya viene descendente) y el de
 * las líneas, la posición que tenían en la lista.
 */
export function buildHistoryDays(sessions: readonly HistorySession[]): HistoryDay[] {
  const byDay = new Map<string, HistoryDay>();

  for (const session of sessions) {
    const key = dayKeyOf(session.startedAt);
    let day = byDay.get(key);
    if (!day) {
      day = { key, sessions: 0, entries: [], practices: 0, avgQuality: null };
      byDay.set(key, day);
    }
    day.sessions += 1;
    day.entries.push(...session.entries);
    day.practices += session.entries.length;
  }

  const days = [...byDay.values()];
  for (const day of days) {
    day.avgQuality = average(
      day.entries.map((entry) => entry.quality).filter((q): q is number => q !== null),
    );
  }

  // La clave es `YYYY-MM-DD`: comparar como cadena ordena igual que la fecha.
  return days.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/**
 * Racha de días consecutivos con ensayo.
 *
 * Se cuenta desde hoy si hoy hay algo, y desde ayer si hoy todavía no —un día a
 * medias no debe romper una racha de tres semanas—. Se mueve sobre la serie
 * completa del rango (con los días vacíos incluidos), no sobre los días que
 * tienen ensayo: saltarse un hueco sería contar días que no existen.
 */
export function practiceStreak(points: readonly HistoryPoint[]): number {
  let index = points.length - 1;
  if (index < 0) return 0;
  if (points[index].practices === 0) index -= 1;

  let streak = 0;
  for (; index >= 0; index -= 1) {
    if (points[index].practices === 0) break;
    streak += 1;
  }
  return streak;
}

/** Serie diaria del rango, del día más antiguo a hoy. */
export function historySeries(
  days: readonly HistoryDay[],
  options: { nowMs: number; range: number },
): HistoryPoint[] {
  const { nowMs, range } = options;
  const span = Math.max(1, Math.floor(range));
  const byKey = new Map(days.map((day) => [day.key, day]));
  const todayKey = todayKeyFor(nowMs);
  const points: HistoryPoint[] = [];

  // Se retrocede con `setDate` sobre la fecha local: resolvería igual un cambio
  // de hora, que es justo lo que una resta de 86 400 000 ms no hace.
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(nowMs);
    date.setDate(date.getDate() - offset);
    date.setHours(12, 0, 0, 0);
    const key = todayKeyFor(date.getTime());
    const day = byKey.get(key);
    points.push({
      key,
      label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      practices: day?.practices ?? 0,
      isToday: key === todayKey,
    });
  }

  return points;
}

/** Cifras del rango. La racha se calcula sobre la serie completa, con sus ceros. */
export function historyStats(
  days: readonly HistoryDay[],
  options: { nowMs: number; range: number },
): HistoryStats {
  const points = historySeries(days, options);
  const rated = days
    .flatMap((day) => day.entries)
    .map((entry) => entry.quality)
    .filter((quality): quality is number => quality !== null);

  const distribution = [0, 0, 0, 0, 0];
  for (const quality of rated) {
    if (quality >= 1 && quality <= 5) distribution[quality - 1] += 1;
  }

  return {
    practices: days.reduce((sum, day) => sum + day.practices, 0),
    sessions: days.reduce((sum, day) => sum + day.sessions, 0),
    activeDays: days.length,
    streak: practiceStreak(points),
    avgQuality: average(rated),
    ratedCount: rated.length,
    distinctTunes: new Set(days.flatMap((day) => day.entries.map((e) => e.repertoireId))).size,
    distribution,
  };
}

/**
 * «Today», «Yesterday» o la fecha larga. `nowMs` se inyecta: la etiqueta no puede
 * depender de un reloj que cambie entre el render y la prueba.
 */
export function dayLabel(key: string, nowMs: number): string {
  const today = todayKeyFor(nowMs);
  if (key === today) return 'Today';

  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === todayKeyFor(yesterday.getTime())) return 'Yesterday';

  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
