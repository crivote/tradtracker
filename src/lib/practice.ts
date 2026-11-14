import { supabase } from './supabase';
import { parseLocalDay } from './format';
import { todayKeyFor } from './practice-storage';

/**
 * La práctica, tal y como la guarda la base desde #56: **una marca es una tune
 * en un día**, no una línea dentro de una sesión. `pr_practice` tiene
 * `unique (user_id, repertoire_id, day)`, así que marcar dos veces la misma tune
 * el mismo día **actualiza** la valoración y el comentario del último toque en
 * vez de duplicar.
 *
 * El día lo compone el cliente con `todayKeyFor` y nunca se deriva de un
 * `timestamptz` en la base: en Madrid el día UTC cambia a las 23:00 locales, y
 * un ensayo de las 23:30 tiene que ser del día en que se tocó.
 */

/**
 * Lo que el usuario puede apuntar de un ensayo en este corte (#10): la calidad
 * es opcional a propósito — registrar no debe exigir puntuar — y el comentario
 * también.
 */
export interface PracticeEntry {
  quality: number | null;
  comment: string | null;
}

/**
 * Cuándo se ensayó. Falta el día a propósito: no lo elige quien llama, sale del
 * instante con `todayKeyFor`. Sin `practicedAt`, el instante es ahora.
 */
export interface PracticeOptions {
  practicedAt?: Date;
}

/**
 * Comentario en blanco = sin comentario. Se recorta también lo que solo lleva
 * espacios para que la base no guarde cadenas que parecen datos y no lo son.
 */
function normalizeComment(comment: string | null): string | null {
  const trimmed = (comment ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Día local `YYYY-MM-DD` del instante del ensayo.
 *
 * `todayKeyFor` compone la fecha con los getters locales; es la única forma
 * admitida de decir «hoy» en este módulo (`toISOString().slice(0, 10)` daría el
 * día siguiente a partir de las 23:00 en Madrid).
 */
function localDayOf(instant: Date): string {
  return todayKeyFor(instant.getTime());
}

/** Las columnas del `onConflict`: el único que hace del día la unidad. */
const PRACTICE_CONFLICT = 'user_id,repertoire_id,day';

/**
 * Una fila de `pr_practice` tal y como la compone el cliente: la tune, el día
 * local y el instante del ensayo. `user_id` no viaja —lo pone la base— y
 * `quality`/`comment` tampoco, para no pisar una valoración previa.
 */
export interface PracticeRow {
  repertoire_id: string;
  day: string;
  practiced_at: string;
}

/**
 * El cuerpo de una tanda, compartido por los dos gestos que escriben varias
 * marcas de golpe: «Mark all» de la lista del día (`markPracticeDay`) y la
 * tanda pasada con fecha del listado (`registerPracticeDay`).
 *
 * Un id repetido haría que el `ON CONFLICT` tocara la misma fila dos veces y
 * PostgREST lo rechazaría (21000), así que se deduplica aquí, conservando el
 * orden de primera aparición: el recuento que devuelve cada gesto es el de
 * filas que viajaron, no el de ids tecleados.
 */
function buildPracticeRows(
  day: string,
  repertoireIds: readonly string[],
  practicedAt: string,
): PracticeRow[] {
  return [...new Set(repertoireIds)].map((repertoireId) => ({
    repertoire_id: repertoireId,
    day,
    practiced_at: practicedAt,
  }));
}

/**
 * Las filas de una tanda **pasada** (#58): una por tune, con el **mediodía
 * local** del día elegido.
 *
 * El mediodía no es capricho: la hora es un dato aproximado —el dueño recuerda
 * el día, no la hora— y el mediodía local cae dentro del día en cualquier huso
 * razonable, mientras que una medianoche UTC se leería como el día anterior o
 * el siguiente en cuanto se formatee en local. Por eso nunca se usa
 * `Date.parse(day)` ni `new Date('YYYY-MM-DD')`, que son UTC medianoche.
 *
 * Pura: sin red, sin `Date.now()`. Un día ilegible se rechaza en vez de
 * inventarse uno, porque una marca con la fecha equivocada es peor que ninguna.
 */
export function practiceRowsForDay(
  day: string,
  repertoireIds: readonly string[],
): PracticeRow[] {
  const midnight = parseLocalDay(day);
  if (Number.isNaN(midnight)) throw new Error('The practice day must be YYYY-MM-DD.');

  // Del día ya validado salen sus componentes locales; el mediodía se compone
  // con el constructor local, que es el único que respeta el día del dueño.
  const parsed = new Date(midnight);
  const noon = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12,
    0,
    0,
    0,
  );
  return buildPracticeRows(day, repertoireIds, noon.toISOString());
}

/**
 * Registra una tanda de ensayos **de un día pasado** (#58), en bloque y con
 * fecha, para lo que ocurrió y no se apuntó.
 *
 * No es «marcar todo hoy»: una marca con la fecha de hoy para media biblioteca
 * corrompería el espaciado, así que el día entra por parámetro y manda. El
 * `unique (user_id, repertoire_id, day)` hace que una tune ya marcada ese día
 * se actualice en vez de duplicarse, y el trigger de la base recalcula
 * `last_practiced_day` por su cuenta.
 *
 * El cuerpo no lleva `quality` ni `comment`: registrar no puntúa y el
 * `DO UPDATE` no debe borrar una valoración puesta antes. Devuelve cuántas
 * filas viajaron —un upsert no distingue alta de actualización—, que es el
 * recuento que el aviso enseña.
 */
export async function registerPracticeDay(
  day: string,
  repertoireIds: readonly string[],
): Promise<number> {
  const rows = practiceRowsForDay(day, repertoireIds);
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('pr_practice')
    .upsert(rows, { onConflict: PRACTICE_CONFLICT });

  if (error) throw new Error(`Could not save the practice: ${error.message}`);
  return rows.length;
}

/**
 * Apunta un ensayo de un tune del repertorio (#10, unidad de día en #56).
 *
 * **Upsert**, no insert: el `unique (user_id, repertoire_id, day)` convierte el
 * segundo toque del día en una actualización. Marcar y después valorar la misma
 * tune no puede dejar dos ensayos en el historial, y con esta forma tampoco hay
 * que «adoptar» una sesión abierta para conseguirlo.
 *
 * `user_id`, `practiced_at` y `created_at` los pone la base; `day` lo pone el
 * cliente porque el día es local. Devuelve el `id` de la fila, que es lo que
 * espera quien abre el popup.
 */
export async function logPractice(
  repertoireId: string,
  entry: PracticeEntry,
  options: PracticeOptions = {},
): Promise<string> {
  const instant = options.practicedAt ?? new Date();
  const day = localDayOf(instant);

  const { data, error } = await supabase
    .from('pr_practice')
    .upsert(
      {
        repertoire_id: repertoireId,
        day,
        practiced_at: instant.toISOString(),
        quality: entry.quality ?? null,
        comment: normalizeComment(entry.comment),
      },
      { onConflict: PRACTICE_CONFLICT },
    )
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Could not save the practice: ${error.message}`);
  if (!data?.id) throw new Error('The practice was saved but no id came back.');

  return data.id;
}

/**
 * Las marcas de **un día concreto** de la lista del día (#36), por día y sin
 * adivinar.
 *
 * Antes se buscaba «la última sesión abierta de hoy» y, cuando esa consulta no
 * acertaba —una recarga, un montaje temprano—, la vista creía no tener sesión y
 * la siguiente marca abría otra. Con la unidad de día no hay nada que
 * interpretar: la pregunta es «qué se marcó hoy», y el `unique` por día se
 * encarga de que la respuesta sea una sola.
 */
export async function fetchDayMarks(day: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('pr_practice')
    .select('repertoire_id')
    .eq('day', day);

  if (error) throw new Error(`Could not load the practice marks: ${error.message}`);

  const marks = Array.isArray(data) ? data : [];
  return marks
    .map((mark: { repertoire_id?: unknown }) => mark?.repertoire_id)
    .filter((id: unknown): id is string => typeof id === 'string');
}

/**
 * Marca varias tunes **del mismo día** en un solo viaje: el gesto «Mark all» de
 * la lista del día.
 *
 * El cuerpo no lleva `quality` ni `comment`: marcar no puntúa (#10) y, al no
 * venir en el `ON CONFLICT DO UPDATE`, una valoración puesta antes desde la
 * ficha no se pierde porque alguien pulse «Mark all». Devuelve cuántas filas
 * viajaron, que es lo que la vista apunta como marcado.
 */
export async function markPracticeDay(
  repertoireIds: readonly string[],
  options: PracticeOptions = {},
): Promise<number> {
  if (repertoireIds.length === 0) return 0;

  const instant = options.practicedAt ?? new Date();
  const day = localDayOf(instant);
  // La composición es la misma que la de una tanda pasada (#58), compartida en
  // `buildPracticeRows`; aquí el instante es el del ensayo, no un mediodía.
  const rows = buildPracticeRows(day, repertoireIds, instant.toISOString());

  const { error } = await supabase
    .from('pr_practice')
    .upsert(rows, { onConflict: PRACTICE_CONFLICT });

  if (error) throw new Error(`Could not save the practice: ${error.message}`);
  return rows.length;
}

/**
 * Recalcula la fecha del último ensayo desde `pr_practice` con la función de la
 * base (#35, #56). El trigger solo **avanza** la fecha: sin este recálculo,
 * quitar la marca dejaría la tune fuera del radar ~2 meses.
 */
export async function recomputeLastPractice(repertoireId: string): Promise<void> {
  const { error } = await supabase.rpc('pr_recompute_last_practice', {
    p_repertoire_id: repertoireId,
  });
  if (error) throw new Error(`Could not recompute the practice date: ${error.message}`);
}

/**
 * Quita una marca puesta por error (#36): borra la fila de ese día **y**
 * recalcula la fecha.
 *
 * Las dos cosas van en la misma función a propósito: son una sola operación y
 * separarlas dejaría el olvido del recálculo al criterio de cada llamante. El
 * día entra por parámetro porque es justo lo que identifica la fila.
 *
 * Si el recálculo falla **después** del borrado, el estado es el peor de los
 * dos —la marca ya no está y la fecha puede seguir movida—, así que el error lo
 * dice con palabras y pide recargar: es un estado que el usuario tiene que
 * conocer, no un fallo que se pueda tragar.
 */
export async function unmarkPractice(repertoireId: string, day: string): Promise<void> {
  const { error } = await supabase
    .from('pr_practice')
    .delete()
    .eq('repertoire_id', repertoireId)
    .eq('day', day);

  if (error) throw new Error(`Could not remove the mark: ${error.message}`);

  try {
    await recomputeLastPractice(repertoireId);
  } catch (recomputeError) {
    const detail = recomputeError instanceof Error ? recomputeError.message : String(recomputeError);
    throw new Error(
      `The mark was removed, but the practice date could not be recalculated — reload the page before trusting it (${detail}).`,
    );
  }
}
