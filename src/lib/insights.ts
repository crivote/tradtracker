/**
 * Panel de estado del repertorio (#22): vencimiento por peldaño, delta semanal,
 * composición semanal y revisitas frente al hueco objetivo.
 *
 * Módulo **puro**: sin red, sin DOM y con el instante inyectado (`nowMs`), para
 * que la pantalla no calcule nada dentro del JSX y las pruebas no dependan del
 * reloj de la máquina. Nada de aquí llama a `Date.now()`.
 *
 * Tres ideas ordenan todo lo que hay abajo:
 *
 *   · **El peldaño decide el ritmo de repaso** (`TARGET_DAYS_BY_BAND`). No todas
 *     las tunes se tocan cada semana: una que se está aprendiendo se cae en dos
 *     días y una cima aguanta un mes. «Vencida» es, exactamente, pasarse de ese
 *     intervalo —no una antigüedad genérica—.
 *   · **El backlog no está en rotación.** `to_learn` no tiene intervalo que
 *     cumplir (nunca se ha empezado) y una **aparcada** conserva su peldaño pero
 *     está fuera de la rotación. Ni una ni otra entran en el histograma ni en el delta;
 *     la composición sí cuenta las aparcadas, porque ahí lo que se mira es el
 *     reparto del repertorio entero por altura.
 *   · **«Sin dato» no es cero.** Una tune sin registro no cae en «60+»: se cuenta
 *     aparte (`sinRegistro`), y un hueco sin observaciones devuelve `null` o una
 *     estructura vacía, nunca un `0` que se lea como «había datos y ninguno
 *     estaba vencido».
 *
 * Las fechas de día (`YYYY-MM-DD`: `pr_practice.day`,
 * `pr_repertoire.last_practiced_day`) son **días locales** y se convierten con
 * `parseLocalDay`; `Date.parse`/`new Date('2026-11-13')` las leería como UTC
 * medianoche y en Madrid un ensayo de las 23:30 caería en el día siguiente. Los
 * instantes (`pr_practice.practiced_at`, `pr_ladder_event.at`) sí son
 * `timestamptz` y se leen como instantes, que es lo que son.
 */
import { daysSinceDay, parseLocalDay } from './format';
import { todayKeyFor } from './practice-storage';
import {
  BANDS,
  isLadderStatus,
  type LadderStatus,
  type RepertoireRow,
} from './repertoire-model';

/**
 * Días que una tune puede pasar sin tocarse en cada peldaño antes de contar
 * como vencida. El orden de magnitud es el de la escalera: lo que se está
 * aprendiendo se cae en dos días, lo que ya se toca solo aguanta dos semanas y
 * una cima se mantiene con un repaso al mes.
 */
export const TARGET_DAYS_BY_BAND: Record<LadderStatus, number> = {
  learning: 2,
  shaky: 4,
  playing_along: 7,
  solo_ready: 14,
  mastered: 30,
};

/** Los cinco peldaños en orden de escalera: `BANDS` ya los tiene así. */
const LADDER_BANDS: readonly LadderStatus[] = BANDS.map((band) => band.status).filter(
  isLadderStatus,
);

/**
 * Una marca del panel: la tune, su día y el instante en que se tocó.
 *
 * No se reutiliza `PracticeMark` a propósito: aquel lleva título, ritmo,
 * valoración y comentario porque el historial los pinta, y esto solo necesita
 * la identidad y los dos tiempos. Copiar el modelo de la otra pantalla ataría
 * este cálculo a que la consulta del historial siga pidiendo lo mismo.
 */
export interface InsightMark {
  repertoireId: string;
  /** `YYYY-MM-DD` local, tal y como lo guarda `pr_practice.day`. */
  day: string;
  /** `timestamptz` del ensayo: es un instante, no un día. */
  practicedAt: string;
}

/**
 * Un evento de la escalera (`pr_ladder_event`), append-only.
 *
 * `source` viaja porque hay que poder distinguir una transición real de un
 * `backfill`, aunque hoy **no** se filtre por él: los `backfill` son la foto del
 * estado en su fecha y cuentan como estado, nunca como transición de ese día.
 */
export interface InsightEvent {
  repertoireId: string;
  kind: 'status' | 'shelved';
  fromValue: string | null;
  toValue: string;
  /** `timestamptz` del cambio. */
  at: string;
  source: string;
}

export interface HistogramBucket {
  key: string;
  label: string;
  count: number;
  pct: number;
}

export interface BandOverdue {
  band: LadderStatus;
  /** Filas del peldaño **con** día de último ensayo legible. */
  practiced: number;
  overdue: number;
  /** Vencidas sobre las practicadas de ese peldaño; 0 si no hay ninguna. */
  pct: number;
}

export interface OverdueHistogram {
  /** Filas en rotación: con peldaño y sin aparcar. */
  universe: number;
  /** Filas del universo sin día de último ensayo: **aparte**, nunca en «60+». */
  sinRegistro: number;
  buckets: HistogramBucket[];
  byBand: BandOverdue[];
  overdue: number;
  /** Vencidas sobre las que tienen día (`universe - sinRegistro`); 0 si no hay. */
  overduePct: number;
}

export interface BandDelta {
  band: LadderStatus;
  currentPct: number;
  previousPct: number;
  deltaPp: number;
}

export interface OverdueDelta {
  currentPct: number;
  previousPct: number;
  /** Puntos porcentuales: `currentPct - previousPct`. */
  deltaPp: number;
  /**
   * Vencidas **hoy** y el domingo, sobre el mismo censo. Son los recuentos que
   * se enseñan en el pie de la gráfica: con dos porcentajes de denominadores
   * distintos —el de la tarjeta y el del pie—, la misma palabra «overdue» decía
   * dos cosas (#65). El recuento no admite doble lectura.
   */
  currentOverdue: number;
  previousOverdue: number;
  /** Tamaño del censo comparado: las mismas tunes en las dos fotos. */
  census: number;
  byBand: BandDelta[];
  /**
   * `false` cuando no hay ninguna marca anterior al domingo de la semana
   * pasada. Entonces no hay comparación: la UI enseña «aún sin historial» y
   * **no** lee `previousPct` ni `deltaPp`.
   */
  enoughHistory: boolean;
}

export interface WeekComposition {
  /** Clave del lunes que abre la semana, `YYYY-MM-DD` local. */
  key: string;
  /** El mismo lunes, en corto (`5 Oct`): es la etiqueta del eje. */
  label: string;
  total: number;
  byBand: Record<LadderStatus, number>;
  /** Filas sin evento `status` hasta el cierre de esa semana. */
  sinEstado: number;
}

export interface RevisitSummary {
  /** Huecos consecutivos comparables (la tune tiene peldaño). */
  pairs: number;
  /** Mediana del hueco en horas; `null` sin pares. */
  medianHours: number | null;
  /** Hueco por debajo de la mitad del objetivo: dos pasadas demasiado seguidas. */
  tooSoon: number;
  /** Hueco entre la mitad y el objetivo: el espaciado que se busca. */
  inBand: number;
  /** Hueco por encima del objetivo: se pasó el plazo. */
  late: number;
  buckets: HistogramBucket[];
}

/* ────────────────────────────────────────────────────────────────
 * Piezas compartidas
 * ──────────────────────────────────────────────────────────────── */

/** Fila en rotación: tiene peldaño y no está en el cajón. Guarda de tipo. */
function isRotationRow(row: RepertoireRow): row is RepertoireRow & { status: LadderStatus } {
  return !row.shelved && isLadderStatus(row.status);
}

/** Un texto que es un peldaño, o `null`. Los eventos llegan como `string`. */
function asLadderStatus(value: string): LadderStatus | null {
  return (LADDER_BANDS as readonly string[]).includes(value) ? (value as LadderStatus) : null;
}

/** Porcentaje sin redondear. Denominador 0 no es un 0 %: es «no hay». */
function percentOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

/** Un decimal: el panel no enseña más precisión de la que puede sostener. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Instante de un `timestamptz`; `null` si no se puede leer. */
function instantOf(iso: string): number | null {
  // Aquí sí vale el constructor de cadenas: `at`/`practicedAt` son instantes con
  // huso, no días locales. El día nunca pasa por aquí.
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Clave del lunes de la semana local que contiene `nowMs`. Las semanas van de
 * lunes a domingo, que es lo que hace que «el fin de la semana pasada» sea
 * exactamente el domingo anterior al lunes de hoy.
 *
 * Se ancla a mediodía antes de restar días por lo mismo que el resto del repo:
 * el día del cambio de hora no tiene 24 horas y una resta de milisegundos
 * caería en el día de al lado.
 */
function weekStartKey(nowMs: number): string {
  const date = new Date(nowMs);
  date.setHours(12, 0, 0, 0);
  const offset = (date.getDay() + 6) % 7; // 0 = lunes
  date.setDate(date.getDate() - offset);
  return todayKeyFor(date.getTime());
}

/** Clave del día desplazado `days` días, con setters locales. */
function shiftDayKey(key: string, days: number): string {
  const ms = parseLocalDay(key);
  if (Number.isNaN(ms)) return key;
  const date = new Date(ms);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return todayKeyFor(date.getTime());
}

/**
 * Medianoche local del día **siguiente** a `key`: la frontera exclusiva de ese
 * día. Sirve para comparar un `timestamptz` con un día local sin inventar un
 * huso: lo que pasó ese domingo a las 23:30 está dentro.
 */
function dayBoundaryAfter(key: string): number {
  const ms = parseLocalDay(key);
  if (Number.isNaN(ms)) return Number.NaN;
  const date = new Date(ms);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Días locales enteros entre dos claves de día; `null` si alguna no se lee. */
function daysBetween(fromKey: string, toKey: string): number | null {
  const from = parseLocalDay(fromKey);
  const to = parseLocalDay(toKey);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  // El redondeo absorbe el día de 23 o 25 horas, igual que `daysSinceDay`.
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Etiqueta del eje: el lunes que abre la semana, en corto (`5 Oct`).
 *
 * No se usa `formatDay` porque formatea con el idioma del navegador y aquí
 * saldría «5 oct 2026» en una pantalla que escribe en inglés; el historial ya
 * resuelve sus etiquetas con `en-GB` fijo, y el eje del panel sigue ese criterio.
 */
function weekLabel(key: string): string {
  const ms = parseLocalDay(key);
  if (Number.isNaN(ms)) return key;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ────────────────────────────────────────────────────────────────
 * Histograma de vencimiento
 * ──────────────────────────────────────────────────────────────── */

interface OverdueRange {
  key: string;
  label: string;
  /** Último día que entra en el tramo, incluido. */
  upTo: number;
}

/**
 * Los tramos del histograma, en días desde el último ensayo. El primero empieza
 * en 0 —hoy, ayer, anteayer— y el último es abierto. `61–90` y `90+` existen
 * porque el tramo viejo había acumulado 143 tunes y una sola barra no dice si
 * son meses o años (pedido del dueño, #65). `sinRegistro` **no está aquí**: una
 * tune que nunca se ha tocado no es una tune de hace 60+ días.
 */
const OVERDUE_RANGES: readonly OverdueRange[] = [
  { key: '0-3', label: '0–3', upTo: 3 },
  { key: '4-7', label: '4–7', upTo: 7 },
  { key: '8-14', label: '8–14', upTo: 14 },
  { key: '15-30', label: '15–30', upTo: 30 },
  { key: '31-60', label: '31–60', upTo: 60 },
  { key: '61-90', label: '61–90', upTo: 90 },
  { key: '90+', label: '90+', upTo: Number.POSITIVE_INFINITY },
];

/** Índice del tramo de una antigüedad en días (siempre ≥ 0). */
function overdueRangeIndex(days: number): number {
  for (let index = 0; index < OVERDUE_RANGES.length; index += 1) {
    if (days <= OVERDUE_RANGES[index].upTo) return index;
  }
  return OVERDUE_RANGES.length - 1;
}

/** Recuento de un peldaño: cuántas tienen día y cuántas ya se han pasado. */
interface BandTally {
  band: LadderStatus;
  practiced: number;
  overdue: number;
}

/** Una observación: el peldaño de la fila y los días que lleva sin tocarse. */
interface BandRecord {
  band: LadderStatus;
  days: number;
}

/**
 * Recuento por peldaño de un conjunto de observaciones. Las cinco bandas salen
 * siempre, en orden de escalera, aunque estén a cero: el panel pinta la fila
 * entera y un peldaño que desaparece mueve el eje.
 */
function tallyBands(records: readonly BandRecord[]): BandTally[] {
  const tallies: BandTally[] = LADDER_BANDS.map((band) => ({
    band,
    practiced: 0,
    overdue: 0,
  }));
  const byBand = new Map(tallies.map((tally) => [tally.band, tally]));

  for (const record of records) {
    const tally = byBand.get(record.band);
    if (!tally) continue; // un peldaño que no conocemos no se cuenta
    tally.practiced += 1;
    // Vencida = pasarse del intervalo del peldaño, no llegar justo.
    if (record.days > TARGET_DAYS_BY_BAND[record.band]) tally.overdue += 1;
  }

  return tallies;
}

function sumPracticed(tallies: readonly BandTally[]): number {
  return tallies.reduce((total, tally) => total + tally.practiced, 0);
}

function sumOverdue(tallies: readonly BandTally[]): number {
  return tallies.reduce((total, tally) => total + tally.overdue, 0);
}

/**
 * Foto del vencimiento **de hoy**: histograma de antigüedades y vencidas por
 * peldaño, sobre las filas en rotación.
 *
 * El día sale de `pr_repertoire.last_practiced_day`, que mantiene el trigger de
 * `pr_practice` y nunca retrocede; una fila con la columna a `null` (o con un
 * texto que no se puede leer) es `sinRegistro` y se cuenta aparte —no se
 * disfraza de «60+» ni se rescata de las marcas: la columna es la foto y una
 * ventana de marcas recortada no puede hacer que una tune parezca más fresca—.
 *
 * `marks` queda en la firma por simetría con `overdueDelta` y porque el panel
 * carga las dos cosas del mismo viaje; hoy no se consume.
 */
export function overdueHistogram(
  rows: readonly RepertoireRow[],
  nowMs: number,
): OverdueHistogram {
  const universe = rows.filter(isRotationRow);
  const counts = OVERDUE_RANGES.map(() => 0);
  const records: BandRecord[] = [];
  let sinRegistro = 0;

  for (const row of universe) {
    const days = daysSinceDay(row.last_practiced_day, nowMs);
    if (days === null) {
      sinRegistro += 1;
      continue;
    }
    counts[overdueRangeIndex(days)] += 1;
    records.push({ band: row.status, days });
  }

  const byBand = tallyBands(records);
  const overdue = sumOverdue(byBand);
  const practiced = sumPracticed(byBand);

  return {
    universe: universe.length,
    sinRegistro,
    // El denominador de los tramos es lo que **tienen registro**, no el universo
    // entero: `sin registro` ya no se pinta en la gráfica (#65) y una barra que
    // se mide contra un total que no aparece se lee como si faltaran tunes.
    // Así los siete tramos suman el 100 % de lo pintado; `sinRegistro` conserva
    // su participación sobre el universo en la tarjeta.
    buckets: OVERDUE_RANGES.map((range, index) => ({
      key: range.key,
      label: range.label,
      count: counts[index],
      pct: round1(percentOf(counts[index], practiced)),
    })),
    byBand: byBand.map((tally) => ({
      band: tally.band,
      practiced: tally.practiced,
      overdue: tally.overdue,
      pct: round1(percentOf(tally.overdue, tally.practiced)),
    })),
    overdue,
    // Aquí el denominador son las que tienen día: «de las que puedo juzgar,
    // cuántas se han pasado». Una tune sin registro no está vencida, está sin
    // empezar, y ya se cuenta en `sinRegistro`.
    overduePct: round1(percentOf(overdue, practiced)),
  };
}

/* ────────────────────────────────────────────────────────────────
 * Tendencia del vencimiento (#65)
 * ──────────────────────────────────────────────────────────────── */

export interface OverdueTrendPoint {
  /** `YYYY-MM-DD` local del día medido. */
  key: string;
  /** `30 Oct`: la misma etiqueta corta que la semana de la composición. */
  label: string;
  overdue: number;
  /** Tunes del censo que ese día se podían juzgar (con peldaño y con ensayo). */
  judged: number;
}

export interface OverdueTrend {
  /** Del día más antiguo al más reciente. */
  points: OverdueTrendPoint[];
  /**
   * `30 Oct`: primer día con estado de escalera conocido, que es donde empieza
   * la serie. `null` cuando no hay ningún evento `status`, y entonces no hay
   * tendencia que enseñar.
   */
  since: string | null;
  /** Días pedidos; si la serie es más corta, es que la historia empieza después. */
  windowDays: number;
}

/**
 * Serie diaria de **vencidas** para ver la tendencia: ¿se gana o se pierde
 * terreno?
 *
 * Va aparte del histograma y no encima de él: el eje del histograma son tramos
 * de antigüedad, no días, y una línea sobre ese eje no sería una tendencia sino
 * una curva acumulada —otra cosa—. Aquí el eje es el tiempo y la pregunta es
 * «cuántas se pasaban de su intervalo cada día».
 *
 * Cada día se mide **como se medía ese día**, no con la vara de hoy:
 *
 *   · El peldaño sale del último evento `status` hasta esa fecha, igual que el
 *     delta semanal. Una tune que aún no tenía estado conocido entonces no entra
 *     en el censo de ese día: no se le inventa un pasado.
 *   · La antigüedad sale del último ensayo **hasta ese día** (el día entra), así
 *     que una tune tocada el día medido no está vencida.
 *   · Sin ningún ensayo anterior no se juzga: «sin registro» no es «vencida»,
 *     igual que en el histograma.
 *
 * La serie empieza en el primer evento de escalera (finales de octubre en esta
 * base): antes de eso no hay peldaño que aplicar, y rellenar hacia atrás con el
 * de hoy sería una historia inventada. `since` lo dice en la tarjeta.
 */
export function overdueTrend(
  rows: readonly RepertoireRow[],
  marks: readonly InsightMark[],
  events: readonly InsightEvent[],
  nowMs: number,
  days: number,
): OverdueTrend {
  const windowDays = Math.max(1, Math.floor(days));
  const todayKey = todayKeyFor(nowMs);

  let firstStatus: number | null = null;
  for (const event of events) {
    if (event.kind !== 'status') continue;
    const ms = instantOf(event.at);
    if (ms === null) continue;
    if (firstStatus === null || ms < firstStatus) firstStatus = ms;
  }
  if (firstStatus === null) return { points: [], since: null, windowDays };

  const firstKey = todayKeyFor(firstStatus);
  const windowStart = shiftDayKey(todayKey, -(windowDays - 1));
  const startKey = firstKey > windowStart ? firstKey : windowStart;
  if (startKey > todayKey) return { points: [], since: null, windowDays };

  const rotation = rows.filter(isRotationRow);

  // Días de ensayo por tune, ascendentes: se avanza un puntero por tune según
  // avanza el calendario, sin recorrer la lista entera en cada día.
  const daysByTune = new Map<string, string[]>();
  for (const mark of marks) {
    const list = daysByTune.get(mark.repertoireId);
    if (list) list.push(mark.day);
    else daysByTune.set(mark.repertoireId, [mark.day]);
  }
  for (const list of daysByTune.values()) list.sort();

  const cursor = new Map<string, number>();
  const points: OverdueTrendPoint[] = [];

  for (let key = startKey; key <= todayKey; key = shiftDayKey(key, 1)) {
    const bandThen = statusMapAt(events, dayBoundaryAfter(key));
    let overdue = 0;
    let judged = 0;

    for (const row of rotation) {
      const band = bandThen.get(row.id);
      if (!band) continue;
      const list = daysByTune.get(row.id);
      if (!list || list[0] > key) continue;

      let index = cursor.get(row.id) ?? 0;
      while (index + 1 < list.length && list[index + 1] <= key) index += 1;
      cursor.set(row.id, index);

      const elapsed = daysBetween(list[index], key);
      if (elapsed === null) continue;
      judged += 1;
      if (elapsed > TARGET_DAYS_BY_BAND[band]) overdue += 1;
    }

    points.push({ key, label: weekLabel(key), overdue, judged });
  }

  return { points, since: weekLabel(startKey), windowDays };
}

/* ────────────────────────────────────────────────────────────────
 * Delta semanal
 * ──────────────────────────────────────────────────────────────── */

/**
 * Estado del peldaño de cada tune en un instante dado, leído del registro
 * append-only: el último evento `status` con `at` **anterior** a la frontera.
 *
 * Los `backfill` valen: son la foto del estado en su fecha. Lo que no se hace es
 * tratarlos como transición del día en que se cargaron —por eso se toma el
 * último por `at` y no «el primero del día»—. Un tune sin evento anterior a la
 * frontera no tiene estado conocido allí y no aparece en el mapa: inventarle el
 * de hoy convertiría la foto vieja en una copia de la nueva y el delta sería
 * siempre cero.
 */
function statusMapAt(events: readonly InsightEvent[], boundary: number): Map<string, LadderStatus> {
  const latest = new Map<string, { ms: number; status: LadderStatus }>();

  for (const event of events) {
    if (event.kind !== 'status') continue;
    const status = asLadderStatus(event.toValue);
    if (!status) continue;
    const ms = instantOf(event.at);
    if (ms === null || ms >= boundary) continue;
    const known = latest.get(event.repertoireId);
    // A igual instante se queda el primero que llega; el adaptador pide `at asc`.
    if (known && ms <= known.ms) continue;
    latest.set(event.repertoireId, { ms, status });
  }

  const state = new Map<string, LadderStatus>();
  for (const [repertoireId, entry] of latest) state.set(repertoireId, entry.status);
  return state;
}

/**
 * Comparación del vencimiento de hoy contra el cierre de la **semana pasada**
 * (el domingo anterior al lunes de hoy).
 *
 * Las dos fotos se miden **sobre el mismo censo**: las tunes que ya estaban en
 * rotación y con ensayo registrado hasta ese domingo. Se comparan consigo
 * mismas, de modo que el delta mide envejecimiento y no un cambio de población:
 *
 *   · La de antes: último ensayo hasta ese domingo y último evento `status` hasta
 *     esa fecha.
 *   · La de hoy: el último día que consta de cada una de esas mismas tunes y su
 *     peldaño actual.
 *
 * Una fila que aún no existía o que no tenía estado registrado entonces queda
 * fuera: no se le supone el peldaño de hoy para inventarle un pasado.
 *
 * `enoughHistory` es `false` cuando el censo comparado está vacío; entonces no hay
 * comparación que enseñar y el panel dice «aún sin historial». En ese caso
 * `previousPct` y `deltaPp` no se leen.
 */
export function overdueDelta(
  rows: readonly RepertoireRow[],
  marks: readonly InsightMark[],
  events: readonly InsightEvent[],
  nowMs: number,
): OverdueDelta {
  const previousSunday = shiftDayKey(weekStartKey(nowMs), -1);
  const boundary = dayBoundaryAfter(previousSunday);
  const statusThen = statusMapAt(events, boundary);

  // Último ensayo de cada tune hasta ese domingo (el domingo entra).
  const lastMark = new Map<string, string>();
  for (const mark of marks) {
    if (mark.day > previousSunday) continue;
    const known = lastMark.get(mark.repertoireId);
    if (!known || mark.day > known) lastMark.set(mark.repertoireId, mark.day);
  }

  // **El mismo censo en las dos fotos.** Se mide cómo envejecen las tunes que ya
  // estaban en rotación y con ensayo registrado el domingo pasado. Si cada foto
  // se midiera sobre su propio conjunto —la de hoy sobre las 116 con día y la de
  // antes sobre las 69 de entonces—, el delta mezclaría envejecimiento con cambio
  // de censo y un repertorio que crece parecería mejorar.
  const previousRecords: BandRecord[] = [];
  const currentRecords: BandRecord[] = [];

  for (const row of rows) {
    if (row.shelved) continue; // aparcar no cambia el peldaño, pero sí la rotación
    const bandThen = statusThen.get(row.id);
    if (!bandThen) continue;
    const addedAt = instantOf(row.added_at);
    if (addedAt !== null && addedAt >= boundary) continue; // todavía no existía
    const dayThen = lastMark.get(row.id);
    if (!dayThen) continue; // sin ensayo hasta ese domingo: sin registro, no vencida

    const daysBefore = daysBetween(dayThen, previousSunday);
    // Hoy: el último día que consta (la columna si está, y si no el del domingo).
    const daysNow = daysSinceDay(row.last_practiced_day ?? dayThen, nowMs);
    const bandNow = asLadderStatus(row.status);
    if (daysBefore === null || daysNow === null || !bandNow) continue;

    previousRecords.push({ band: bandThen, days: daysBefore });
    currentRecords.push({ band: bandNow, days: daysNow });
  }

  const previous = tallyBands(previousRecords);
  const current = tallyBands(currentRecords);

  const currentPct = round1(percentOf(sumOverdue(current), sumPracticed(current)));
  const previousPct = round1(percentOf(sumOverdue(previous), sumPracticed(previous)));

  return {
    currentPct,
    previousPct,
    // La resta se hace sobre lo que se enseña, no sobre los valores sin
    // redondear: el lector tiene que poder comprobar la cuenta de cabeza. El
    // error máximo es de una décima de punto, y no hay dos cifras que no cuadren.
    deltaPp: round1(currentPct - previousPct),
    currentOverdue: sumOverdue(current),
    previousOverdue: sumOverdue(previous),
    census: sumPracticed(current),
    byBand: LADDER_BANDS.map((band, index) => {
      const now = current[index];
      const then = previous[index];
      const nowPct = round1(percentOf(now.overdue, now.practiced));
      const thenPct = round1(percentOf(then.overdue, then.practiced));
      return {
        band,
        currentPct: nowPct,
        previousPct: thenPct,
        deltaPp: round1(nowPct - thenPct),
      };
    }),
    enoughHistory: previousRecords.length > 0,
  };
}

/* ────────────────────────────────────────────────────────────────
 * Composición semanal
 * ──────────────────────────────────────────────────────────────── */

/**
 * Reparto del repertorio por peldaño al cierre de cada una de las `weeks`
 * últimas semanas, de la más antigua a la que contiene hoy.
 *
 * El universo incluye **las aparcadas** (`status !== 'to_learn'`): ahí lo que se
 * mira es el reparto del repertorio entero por altura, y una aparcada conserva
 * su peldaño. El backlog no entra: nunca ha estado en la escalera.
 *
 * Cada semana se lee con el **último evento `status` hasta su domingo**. Los
 * `backfill` cuentan como estado en esa fecha y nunca como transición del día en
 * que se cargaron, así que las semanas anteriores al primer evento salen con
 * todo en `sinEstado` —que es la verdad de esta base: la escalera solo tiene
 * historia desde finales de octubre—. No se rellena hacia atrás con el estado de
 * hoy: una serie inventada hacia atrás se lee como historia y no lo es.
 *
 * `total` es el universo de hoy en todas las semanas, para que las columnas sean
 * comparables a simple vista; `sinEstado` es lo que de esa foto no se conocía.
 */
export function compositionByWeek(
  rows: readonly RepertoireRow[],
  events: readonly InsightEvent[],
  weeks: number,
  nowMs: number,
): WeekComposition[] {
  const span = Number.isFinite(weeks) ? Math.floor(weeks) : 0;
  if (span <= 0) return [];

  const universe = rows.filter((row) => row.status !== 'to_learn');
  const firstMonday = weekStartKey(nowMs);
  const composition: WeekComposition[] = [];

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const startKey = shiftDayKey(firstMonday, -7 * offset);
    const endKey = shiftDayKey(startKey, 6);
    const state = statusMapAt(events, dayBoundaryAfter(endKey));

    const byBand: Record<LadderStatus, number> = {
      learning: 0,
      shaky: 0,
      playing_along: 0,
      solo_ready: 0,
      mastered: 0,
    };
    let sinEstado = 0;

    for (const row of universe) {
      const band = state.get(row.id);
      if (!band) {
        sinEstado += 1;
        continue;
      }
      byBand[band] += 1;
    }

    composition.push({
      key: startKey,
      label: weekLabel(startKey),
      total: universe.length,
      byBand,
      sinEstado,
    });
  }

  return composition;
}

/* ────────────────────────────────────────────────────────────────
 * Revisitas frente al hueco objetivo
 * ──────────────────────────────────────────────────────────────── */

interface RevisitRange {
  key: string;
  label: string;
}

/**
 * Tramos del hueco **relativos al objetivo del peldaño**: un hueco de tres días
 * es corto para una cima y largo para lo que se está aprendiendo, así que lo que
 * se mide es `hueco / objetivo`, no el hueco suelto.
 *
 * Las fronteras las pone `revisitRangeIndex` y son las mismas que las de los
 * contadores: `[0, 0.5)`, `[0.5, 1]`, `(1, 2)` y `[2, ∞)`. Un hueco exactamente
 * igual al objetivo se queda en `0.5–1×`: cumplió, no se pasó.
 */
const REVISIT_RANGES: readonly RevisitRange[] = [
  { key: 'under-0.5', label: '<0.5×' },
  { key: '0.5-1', label: '0.5–1×' },
  { key: '1-2', label: '1–2×' },
  { key: '2+', label: '≥2×' },
];

/**
 * Tramo de una revisita por su ratio. Las fronteras son las MISMAS que las de
 * `tooSoon`/`inBand`/`late`: `[0, 0.5)`, `[0.5, 1]`, `(1, 2)`, `[2, ∞)`. Un hueco
 * exactamente igual al objetivo es «en banda» —cumplido justo— y tiene que caer
 * en el mismo cubo que el contador dice, o el gráfico y la cifra se contradicen
 * en ese punto.
 */
function revisitRangeIndex(ratio: number): number {
  if (ratio < 0.5) return 0;
  if (ratio <= 1) return 1;
  if (ratio < 2) return 2;
  return 3;
}

/**
 * Mediana simple: el valor de en medio, o la media de los dos de en medio cuando
 * hay un número par. Sin interpolar entre percentiles —con catorce pares, una
 * interpolación sería precisión de mentira—. `null` sin valores.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Huecos entre ensayos consecutivos de la misma tune, en **horas**, comparados
 * con el objetivo de su peldaño.
 *
 * Se mide con `practiced_at` y no con el día porque dos pasadas del mismo día
 * son una revisita de dos horas, no de cero días. Un par solo cuenta si la tune
 * tiene peldaño con objetivo: sin peldaño no hay nada contra lo que comparar y
 * meterlo en la mediana ensuciaría justo la cifra que se quiere leer.
 *
 * `under` es hueco **menor** que el objetivo y `over` **mayor**: un hueco
 * exactamente igual no es ni una cosa ni la otra, así que `under + over` puede
 * ser menor que `pairs` (raro, pero es la cuenta honesta).
 */
export function revisits(
  marks: readonly InsightMark[],
  rows: readonly RepertoireRow[],
): RevisitSummary {
  const bandById = new Map<string, LadderStatus>();
  for (const row of rows) {
    const band = asLadderStatus(row.status);
    if (band) bandById.set(row.id, band);
  }

  const byTune = new Map<string, InsightMark[]>();
  for (const mark of marks) {
    const list = byTune.get(mark.repertoireId);
    if (list) list.push(mark);
    else byTune.set(mark.repertoireId, [mark]);
  }

  const gaps: Array<{ hours: number; band: LadderStatus }> = [];
  for (const [repertoireId, tuneMarks] of byTune) {
    const band = bandById.get(repertoireId);
    if (!band) continue; // backlog o fila ausente: sin objetivo
    const times = tuneMarks
      .map((mark) => instantOf(mark.practicedAt))
      .filter((ms): ms is number => ms !== null)
      .sort((left, right) => left - right);
    for (let index = 1; index < times.length; index += 1) {
      gaps.push({ hours: (times[index] - times[index - 1]) / 3_600_000, band });
    }
  }

  const counts = REVISIT_RANGES.map(() => 0);
  let tooSoon = 0;
  let inBand = 0;
  let late = 0;

  for (const gap of gaps) {
    const targetHours = TARGET_DAYS_BY_BAND[gap.band] * 24;
    const ratio = gap.hours / targetHours;
    // Tres cubos que suman `pairs`: antes, en banda y tarde. Un `under` que
    // metiera la banda sana dentro de «demasiado pronto» diría lo contrario de
    // lo que el panel tiene que decidir.
    if (ratio < 0.5) tooSoon += 1;
    else if (ratio <= 1) inBand += 1;
    else late += 1;
    counts[revisitRangeIndex(ratio)] += 1;
  }

  const medianHours = median(gaps.map((gap) => gap.hours));

  return {
    pairs: gaps.length,
    medianHours: medianHours === null ? null : round1(medianHours),
    tooSoon,
    inBand,
    late,
    buckets: REVISIT_RANGES.map((range, index) => ({
      key: range.key,
      label: range.label,
      count: counts[index],
      pct: round1(percentOf(counts[index], gaps.length)),
    })),
  };
}
