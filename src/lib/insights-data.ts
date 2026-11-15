/**
 * Adaptador de datos del panel de estado (#22): las dos consultas que alimentan
 * `insights.ts`, con el cliente de Supabase simulado en las pruebas.
 *
 * Dos reglas que el cálculo no puede garantizar y que por eso viven aquí:
 *
 *   · **Columnas, no pantallas.** Se piden exactamente las columnas que el
 *     modelo consume y en camelCase salen del adaptador (`fromValue`), como en
 *     el resto de la capa de datos: la vista nunca nombra una columna.
 *   · **Tope a la vista, y es el del servidor.** `max_rows` de PostgREST en este
 *     proyecto es **1 000** (medido el 2026-11-15 en `/v1/projects/<ref>/postgrest`
 *     y confirmado por la respuesta: pedir 5 000 devolvía 1 000). El cliente
 *     pide ese mismo número, así que puede avisar cuando la carga se corta;
 *     antes pedía 5 000, el servidor devolvía 1 000 y el aviso —que comparaba
 *     contra 5 000— no saltaba nunca.
 *   · **Se piden las filas más recientes, no las más antiguas.** Con el tope
 *     delante, el orden decide qué se pierde: ascendente dejaba fuera justo el
 *     presente (las 1 000 más viejas llegaban hasta 2024-09-16, y `alive · 14
 *     days` salía a 0 con 153 marcas recientes en la base). Descendente, lo que
 *     se corta es lo más viejo, que es lo que menos pesa en el panel.
 *
 * No se pagina en silencio. Un panel de estado que suma de menos y no lo dice
 * miente con más autoridad que uno vacío.
 */
import type { InsightEvent, InsightMark } from './insights';
import { supabase } from './supabase';

/**
 * Tope de filas de cada consulta: el `max_rows` real de PostgREST en este
 * proyecto. Al alcanzarlo se devuelve lo cargado **y se avisa**.
 */
export const INSIGHT_ROW_LIMIT = 1000;

/** Columnas de la marca: el día, el instante real y la tune. Nada más. */
const MARK_COLUMNS = 'day,practiced_at,repertoire_id';

/** Columnas del evento de escalera, en el orden en que se leen. */
const EVENT_COLUMNS = 'repertoire_id,kind,from_value,to_value,at,source';

interface RawMarkRow {
  day?: unknown;
  practiced_at?: unknown;
  repertoire_id?: unknown;
}

interface RawEventRow {
  repertoire_id?: unknown;
  kind?: unknown;
  from_value?: unknown;
  to_value?: unknown;
  at?: unknown;
  source?: unknown;
}

/**
 * Aviso de tope alcanzado. Va por consola porque la firma devuelve las filas y
 * nada más —y así tiene que quedarse: el corte B consume `InsightMark[]`—; el
 * aviso sirve para quien mire la consola y para que la prueba pueda comprobar
 * que el corte se nota en vez de tragárselo.
 */
function warnTruncated(table: string, rows: number): void {
  console.warn(
    `[insights] ${table}: ${rows} rows is the ${INSIGHT_ROW_LIMIT}-row cap — ` +
      'the panel is showing a truncated series.',
  );
}

/**
 * Las marcas de `pr_practice`: una fila por tune y día.
 *
 * `practiced_at` es el instante real del ensayo (lo escribe el cliente al
 * apuntar, también en una marca retroactiva), y es lo único con lo que se pueden
 * medir huecos de horas entre dos pasadas. Se ordena **de la más reciente a la
 * más antigua** por él: con el tope de 1 000 delante, es lo que garantiza que lo
 * que llega es el presente —el modelo reordena después por tune donde lo
 * necesita (revisitas)—.
 *
 * Una fila sin día, sin tune o sin instante no es una marca: se descarta en vez
 * de rellenar el hueco con un valor inventado.
 */
export async function fetchInsightMarks(): Promise<InsightMark[]> {
  const { data, error } = await supabase
    .from('pr_practice')
    .select(MARK_COLUMNS)
    .order('practiced_at', { ascending: false })
    .limit(INSIGHT_ROW_LIMIT);

  if (error) throw new Error(`Could not load the practice marks: ${error.message}`);

  const rows = Array.isArray(data) ? (data as RawMarkRow[]) : [];
  const marks: InsightMark[] = [];

  for (const row of rows) {
    const day = typeof row.day === 'string' ? row.day : null;
    const repertoireId = typeof row.repertoire_id === 'string' ? row.repertoire_id : null;
    const practicedAt = typeof row.practiced_at === 'string' ? row.practiced_at : null;
    if (!day || !repertoireId || !practicedAt) continue;
    marks.push({ repertoireId, day, practicedAt });
  }

  if (rows.length >= INSIGHT_ROW_LIMIT) warnTruncated('pr_practice', rows.length);

  return marks;
}

/**
 * Los eventos de `pr_ladder_event`, del más antiguo al más reciente.
 *
 * La tabla es append-only y es la única fuente del peldaño **en una fecha**: la
 * composición semanal y el delta leen «el último evento `status` hasta tal día».
 * Hoy todos los eventos son `source = 'backfill'` y aun así valen —son la foto
 * del estado en su fecha—; el modelo no filtra por `source`, solo por `kind`.
 *
 * `from_value` es `null` en el alta de la fila (no había estado anterior), así
 * que `null` significa «no había» y no se sustituye por la cadena vacía.
 */
export async function fetchInsightEvents(): Promise<InsightEvent[]> {
  const { data, error } = await supabase
    .from('pr_ladder_event')
    .select(EVENT_COLUMNS)
    .order('at', { ascending: true })
    .limit(INSIGHT_ROW_LIMIT);

  if (error) throw new Error(`Could not load the ladder events: ${error.message}`);

  const rows = Array.isArray(data) ? (data as RawEventRow[]) : [];
  const events: InsightEvent[] = [];

  for (const row of rows) {
    const repertoireId = typeof row.repertoire_id === 'string' ? row.repertoire_id : null;
    const toValue = typeof row.to_value === 'string' ? row.to_value : null;
    const at = typeof row.at === 'string' ? row.at : null;
    // Sin tune, sin valor final o sin instante no hay evento que situar en el
    // tiempo: descartarlo es lo único honesto que se puede hacer con él.
    if (!repertoireId || !toValue || !at) continue;
    // Solo los dos tipos que la tabla documenta (016). Un `kind` que no
    // conocemos no se cuela como cambio de peldaño.
    if (row.kind !== 'status' && row.kind !== 'shelved') continue;

    events.push({
      repertoireId,
      kind: row.kind,
      fromValue: typeof row.from_value === 'string' ? row.from_value : null,
      toValue,
      at,
      source: typeof row.source === 'string' ? row.source : '',
    });
  }

  if (rows.length >= INSIGHT_ROW_LIMIT) warnTruncated('pr_ladder_event', rows.length);

  return events;
}
