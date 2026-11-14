/**
 * Lo que las dos pantallas del panel (#22) necesitan **además** del cálculo del
 * corte A: agrupar las marcas en una serie diaria, contar tunes vivas, la racha y
 * dos etiquetas de fecha.
 *
 * Nada de aquí decide umbrales ni censos: los tramos, el delta, la composición y
 * las revisitas los pone `insights.ts` tal cual. Esto es la vista —pasar de «una
 * marca por tune y día» a «cuántas tunes al día»— y por eso vive fuera de él.
 *
 * Sin `Date.now()`: el instante entra por parámetro, como en todo el corte.
 */
import { daysSinceDay } from './format';
import type { InsightEvent, InsightMark } from './insights';
import {
  practiceStreak,
  rangeStartKey,
  seriesFromCounts,
  type HistoryPoint,
} from './practice-history';

/**
 * Marcas por día, contando **tunes distintas**: dos filas de la misma tune el
 * mismo día son un ensayo, no dos. El `unique (user_id, repertoire_id, day)` de
 * `pr_practice` ya lo garantiza; se deduplica igual porque es aquí donde la
 * gráfica se leería mal si algún día dejara de garantizarlo.
 */
export function tunesPerDay(marks: readonly InsightMark[]): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const mark of marks) {
    const key = `${mark.repertoireId}|${mark.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(mark.day, (counts.get(mark.day) ?? 0) + 1);
  }
  return counts;
}

/**
 * Tunes distintas con al menos una marca en los últimos `days` días, hoy
 * incluido: la cifra «vivas 14 d» del panel. `rangeStartKey` es la misma
 * frontera que usa el rango del historial, y las claves de día se comparan como
 * texto porque `YYYY-MM-DD` ordena igual que la fecha.
 */
export function aliveInRange(
  marks: readonly InsightMark[],
  nowMs: number,
  days: number,
): number {
  const from = rangeStartKey(nowMs, days);
  const tunes = new Set<string>();
  for (const mark of marks) if (mark.day >= from) tunes.add(mark.repertoireId);
  return tunes.size;
}

/**
 * Serie del ritmo: tunes distintas por día en el rango pedido (7/30/90), con los
 * días vacíos a cero. Es la misma serie —mismas claves, mismas etiquetas, mismo
 * «hoy»— que la del historial, porque sale del mismo `seriesFromCounts`.
 */
export function paceSeries(
  marks: readonly InsightMark[],
  options: { nowMs: number; range: number },
): HistoryPoint[] {
  return seriesFromCounts(tunesPerDay(marks), options);
}

/** Tope de la ventana con la que se mide la racha: más de un año no aporta. */
const STREAK_WINDOW_MAX = 400;

/**
 * Días consecutivos con algún ensayo, contados desde hoy (o desde ayer, si hoy
 * todavía no hay nada) hacia atrás.
 *
 * La cuenta la hace `practiceStreak` sobre una serie **con sus ceros**, así que
 * el hueco corta la racha en vez de saltarse un día. La ventana empieza en el
 * día más antiguo del que hay marca: así una racha larga no se corta por el
 * rango que el usuario tenga elegido en otra pantalla.
 */
export function streakFromMarks(marks: readonly InsightMark[], nowMs: number): number {
  const counts = tunesPerDay(marks);
  const days = [...counts.keys()].sort();
  const earliest = days[0];
  const since = earliest === undefined ? 0 : (daysSinceDay(earliest, nowMs) ?? 0);
  const span = Math.min(STREAK_WINDOW_MAX, Math.max(7, since + 1));
  return practiceStreak(seriesFromCounts(counts, { nowMs, range: span }));
}

/**
 * El domingo con el que se compara el delta, en corto y con día (`Sunday 8`).
 *
 * Es la misma frontera que calcula `overdueDelta` —el domingo anterior al lunes
 * de la semana de hoy—; se repite aquí solo para ponerle nombre en la tarjeta,
 * porque el modelo devuelve cifras y no fechas.
 */
export function previousSundayLabel(nowMs: number): string {
  const date = new Date(nowMs);
  date.setHours(12, 0, 0, 0);
  // 0 = lunes: se retrocede al lunes de esta semana y uno más, al domingo.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) - 1);
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' });
}

/**
 * `30 Oct`: el primer día con estado registrado en la escalera (`null` si no hay
 * ningún evento `status`). Es lo que explica una composición toda en `sinEstado`
 * —la escalera no tiene historia anterior—, y sale del dato, no de una constante.
 */
export function ladderHistorySince(events: readonly InsightEvent[]): string | null {
  let earliest: number | null = null;
  for (const event of events) {
    if (event.kind !== 'status') continue;
    const ms = new Date(event.at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  if (earliest === null) return null;
  return new Date(earliest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
