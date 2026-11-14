/**
 * Historial de ensayos: lectura y modelo.
 *
 * Desde #56 la práctica se lee **por marcas**: una fila de `pr_practice` es una
 * tune en un día. El día (`day`) ya es local —lo compuso el cliente con
 * `todayKeyFor` al apuntar—, así que agrupar es agrupar por esa columna, sin
 * convertir ningún instante.
 *
 * Dos cosas que no se hacen aquí:
 *   · **No se agrega en la base.** `pr_repertoire_stats` da totales por tune, no
 *     una serie diaria; un RPC nuevo solo para una pantalla de lectura sería más
 *     superficie que la que resuelve. Se traen las marcas del rango —son
 *     decenas, no miles— y se agrupan en memoria.
 *   · **No se inventa el día.** La clave de día es la de la base, y donde hace
 *     falta componerla (el rango, la serie) se usa `todayKeyFor`, nunca
 *     `toISOString()`: en Madrid, un ensayo a las 23:30 es del día en que se
 *     tocó, no del siguiente.
 *
 * El modelo puro (`buildHistoryDays`, `historyStats`, `historySeries`) no toca la
 * red y se prueba aparte.
 */
import { supabase } from './supabase';
import { todayKeyFor } from './practice-storage';

export const HISTORY_RANGES = [7, 30, 90] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export const DEFAULT_HISTORY_RANGE: HistoryRange = 30;

/** Una marca: una tune tocada un día. */
export interface PracticeMark {
  /** `YYYY-MM-DD` local, tal y como lo guarda `pr_practice.day`. */
  day: string;
  repertoireId: string;
  title: string;
  rhythm: string | null;
  /** 1–5, o `null` si el ensayo se apuntó sin puntuar (es lo normal). */
  quality: number | null;
  comment: string | null;
}

/** Un día local con lo que se ensayó en él. */
export interface HistoryDay {
  /** `YYYY-MM-DD` local. */
  key: string;
  entries: PracticeMark[];
  practices: number;
  avgQuality: number | null;
}

export interface HistoryStats {
  practices: number;
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
 * Un solo embed de dos niveles (`pr_practice → pr_repertoire → pr_tunes`): antes
 * colgaba de la línea de la sesión y ahora de la marca, que es la unidad.
 *
 * `!inner` en los dos: una marca sin fila de repertorio no existe (el borrado es
 * en cascada), y un embed opcional solo añadiría nulos que habría que filtrar
 * después.
 *
 * El tope de 1.000 filas es el máximo por defecto de PostgREST y sobra para 90
 * días de una persona (el repertorio real ronda las 8 marcas diarias). Si algún
 * día se queda corto, la gráfica sigue siendo correcta para lo cargado; lo que no
 * se hace es paginar en silencio y contar de menos sin decirlo.
 */
const HISTORY_SELECT = [
  'day',
  'quality',
  'comment',
  'repertoire_id',
  'pr_repertoire!inner(custom_title,pr_tunes!inner(name,rhythm))',
].join(',');

const HISTORY_LIMIT = 1000;

interface RawMark {
  day?: unknown;
  quality?: unknown;
  comment?: unknown;
  repertoire_id?: unknown;
  pr_repertoire?: {
    custom_title?: unknown;
    pr_tunes?: { name?: unknown; rhythm?: unknown } | null;
  } | null;
}

export interface FetchHistoryOptions {
  /** Instante de referencia: el rango se cuenta desde su día local. */
  nowMs: number;
  /** Días hacia atrás, incluido hoy. */
  range: number;
}

/**
 * La clave del primer día del rango, `days - 1` días antes del día local de
 * `nowMs`.
 *
 * Se retrocede con `setDate` sobre la fecha local, no con una resta de
 * 86 400 000 ms: el día del cambio de hora dura 23 o 25 horas y la resta caería
 * en el día de al lado.
 */
export function rangeStartKey(nowMs: number, days: number): string {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - (days - 1));
  date.setHours(12, 0, 0, 0);
  return todayKeyFor(date.getTime());
}

/** Las marcas del rango, del día más reciente al más antiguo. */
export async function fetchPracticeHistory(
  options: FetchHistoryOptions,
): Promise<PracticeMark[]> {
  const { nowMs, range } = options;
  const days = Math.max(1, Math.floor(range));

  const { data, error } = await supabase
    .from('pr_practice')
    .select(HISTORY_SELECT)
    .gte('day', rangeStartKey(nowMs, days))
    // `day` manda; dentro del día, el orden en que se tocaron.
    .order('day', { ascending: false })
    .order('practiced_at', { ascending: true })
    .limit(HISTORY_LIMIT);

  if (error) throw new Error(`Could not load the practice history: ${error.message}`);

  const rows = Array.isArray(data) ? (data as RawMark[]) : [];
  const marks: PracticeMark[] = [];

  for (const row of rows) {
    const day = typeof row.day === 'string' ? row.day : null;
    const repertoireId = typeof row.repertoire_id === 'string' ? row.repertoire_id : null;
    // Sin día o sin tune no hay marca que pintar: los dos son la identidad.
    if (!day || !repertoireId) continue;

    const tune = row.pr_repertoire?.pr_tunes ?? null;
    const custom = row.pr_repertoire?.custom_title;
    const name = typeof tune?.name === 'string' ? tune.name : '';
    const title = typeof custom === 'string' && custom.trim() ? custom : name || 'Untitled tune';

    marks.push({
      day,
      repertoireId,
      title,
      rhythm: typeof tune?.rhythm === 'string' ? tune.rhythm : null,
      quality: typeof row.quality === 'number' ? row.quality : null,
      comment: typeof row.comment === 'string' && row.comment.trim() ? row.comment : null,
    });
  }

  return marks;
}

/** Media con dos decimales, o `null` sin valoraciones. */
function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}

/**
 * Las marcas agrupadas por su día local, del más reciente al más antiguo. El
 * orden dentro del día es el de la consulta, que ya viene por `practiced_at`.
 */
export function buildHistoryDays(marks: readonly PracticeMark[]): HistoryDay[] {
  const byDay = new Map<string, HistoryDay>();

  for (const mark of marks) {
    let day = byDay.get(mark.day);
    if (!day) {
      day = { key: mark.day, entries: [], practices: 0, avgQuality: null };
      byDay.set(mark.day, day);
    }
    day.entries.push(mark);
    day.practices += 1;
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
