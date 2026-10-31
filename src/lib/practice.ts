import { supabase } from './supabase';

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
 * Comentario en blanco = sin comentario. Se recorta también lo que solo lleva
 * espacios para que la base no guarde cadenas que parecen datos y no lo son.
 */
function normalizeComment(comment: string | null): string | null {
  const trimmed = (comment ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Apunta un ensayo de un tune del repertorio (#10, corte 1).
 *
 * Una sesión con un solo tune: la forma del dato es la misma que usará el
 * historial, así que no hay un camino corto con otra forma. La sesión se inserta
 * **sin cuerpo** — `user_id` y `started_at` los pone la base (`default
 * auth.uid()` / `default now()`) — y se pide el `id` de vuelta para colgar la
 * línea.
 *
 * Si la línea falla, la sesión recién creada se borra (mejor esfuerzo) y se
 * lanza el error original: una sesión vacía sería un ensayo fantasma en el
 * historial. `last_practiced_at` lo mueve el trigger de la base al insertar la
 * línea; el cliente nunca lo escribe.
 */
export async function logPractice(
  repertoireId: string,
  entry: PracticeEntry
): Promise<void> {
  const { data, error } = await supabase.from('pr_sessions').insert({}).select('id').maybeSingle();

  if (error) throw new Error(`Could not save the practice: ${error.message}`);
  if (!data?.id) throw new Error('The practice was saved but no id came back.');

  const sessionId = data.id;

  const { error: lineError } = await supabase.from('pr_session_tunes').insert({
    session_id: sessionId,
    repertoire_id: repertoireId,
    quality: entry.quality ?? null,
    comment: normalizeComment(entry.comment),
  });

  if (lineError) {
    // Compensación: la sesión sin línea no debe quedar. Si el borrado también
    // falla no hay nada mejor que hacer desde aquí; manda el error de la línea.
    try {
      await supabase.from('pr_sessions').delete().eq('id', sessionId);
    } catch {
      /* mejor esfuerzo */
    }
    throw new Error(`Could not save the practice: ${lineError.message}`);
  }
}

/* ────────────────────────────────────────────────────────────────
 * Sesión de la lista del día (#36)
 * ──────────────────────────────────────────────────────────────── */

/** Una marca de la lista: qué tune y en qué posición de la cola estaba. */
export interface SessionMark {
  repertoireId: string;
  /** Índice 0-based de la fila en la lista del día. */
  position: number;
}

/** La sesión de hoy ya abierta, con lo que lleva marcado. */
export interface TodaySession {
  sessionId: string;
  markedIds: string[];
}

/** Una línea de `pr_session_tunes` tal y como la escribe este corte. */
function markRow(sessionId: string, mark: SessionMark) {
  return {
    session_id: sessionId,
    repertoire_id: mark.repertoireId,
    // La calidad es opcional a propósito (#10): marcar en la lista no puntúa.
    quality: null,
    position: mark.position,
  };
}

/**
 * La sesión de hoy sin cerrar, si existe (#36). Se busca por `started_at`
 * dentro del día local que empieza en `dayStartMs` y `ended_at is null`, la más
 * reciente: si el usuario abrió dos, se reanuda la última.
 *
 * «No hay sesión» es `null`, no un error: abrir la lista por la mañana no crea
 * nada y no puede parecer un fallo.
 */
export async function findTodaySession(dayStartMs: number): Promise<TodaySession | null> {
  const { data, error } = await supabase
    .from('pr_sessions')
    .select('id,started_at,pr_session_tunes(repertoire_id)')
    .gte('started_at', new Date(dayStartMs).toISOString())
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load today's practice: ${error.message}`);
  if (!data?.id) return null;

  const lines = Array.isArray(data.pr_session_tunes) ? data.pr_session_tunes : [];
  const markedIds = lines
    .map((line: { repertoire_id?: unknown }) => line?.repertoire_id)
    .filter((id: unknown): id is string => typeof id === 'string');

  return { sessionId: data.id, markedIds };
}

/**
 * Abre la sesión de hoy y cuelga de ella la primera tanda de marcas (#36).
 *
 * Patrón de F4: la sesión se inserta **sin cuerpo** (`user_id` y `started_at`
 * los pone la base) y se pide el `id`; si la tanda falla, la sesión recién
 * creada se borra. Una sesión vacía sería un ensayo fantasma en el historial, y
 * ese es justo el estado que evita crear la sesión al abrir la lista.
 */
export async function createSessionWithMarks(marks: readonly SessionMark[]): Promise<string> {
  if (marks.length === 0) {
    throw new Error('A practice session needs at least one tune.');
  }

  const { data, error } = await supabase.from('pr_sessions').insert({}).select('id').maybeSingle();

  if (error) throw new Error(`Could not save the practice: ${error.message}`);
  if (!data?.id) throw new Error('The practice was saved but no id came back.');

  const sessionId = data.id;
  const { error: lineError } = await supabase
    .from('pr_session_tunes')
    .insert(marks.map((mark) => markRow(sessionId, mark)));

  if (lineError) {
    try {
      await supabase.from('pr_sessions').delete().eq('id', sessionId);
    } catch {
      /* mejor esfuerzo */
    }
    throw new Error(`Could not save the practice: ${lineError.message}`);
  }

  return sessionId;
}

/**
 * Añade marcas a una sesión ya abierta y devuelve **cuántas escribió de
 * verdad**.
 *
 * La tanda va en un viaje. Si choca con `23505` (otra pestaña marcó alguna de
 * las mismas a la vez) se reintenta fila a fila ignorando los duplicados: el
 * resultado final es el mismo y perder las demás por una repetida no lo es. Por
 * eso el recuento es el de filas escritas, no el de filas pedidas.
 */
export async function addSessionMarks(
  sessionId: string,
  marks: readonly SessionMark[],
): Promise<number> {
  if (marks.length === 0) return 0;

  const rows = marks.map((mark) => markRow(sessionId, mark));
  const { error } = await supabase.from('pr_session_tunes').insert(rows);
  if (!error) return rows.length;
  if (error.code !== '23505') {
    throw new Error(`Could not save the practice: ${error.message}`);
  }

  let written = 0;
  for (const row of rows) {
    const { error: rowError } = await supabase.from('pr_session_tunes').insert(row);
    if (!rowError) {
      written += 1;
      continue;
    }
    if (rowError.code === '23505') continue; // otra pestaña la marcó: mismo resultado
    throw new Error(`Could not save the practice: ${rowError.message}`);
  }
  return written;
}

/**
 * Recalcula `last_practiced_at` desde el historial con la función de la base
 * (#35). El trigger solo **avanza** la fecha: sin este recálculo, quitar la
 * marca dejaría la tune fuera del radar ~2 meses.
 */
export async function recomputeLastPracticed(repertoireId: string): Promise<void> {
  const { error } = await supabase.rpc('pr_recompute_last_practiced', {
    p_repertoire_id: repertoireId,
  });
  if (error) throw new Error(`Could not recompute the practice date: ${error.message}`);
}

/**
 * Quita una marca puesta por error (#36): borra la línea **y** recalcula la
 * fecha.
 *
 * Las dos cosas van en la misma función a propósito: son una sola operación y
 * separarlas dejaría el olvido del recálculo al criterio de cada llamante.
 *
 * Si el recálculo falla **después** del borrado, el estado es el peor de los
 * dos —la marca ya no está y la fecha puede seguir movida—, así que el error lo
 * dice con palabras y pide recargar: es un estado que el usuario tiene que
 * conocer, no un fallo que se pueda tragar.
 */
export async function unmarkSessionTune(sessionId: string, repertoireId: string): Promise<void> {
  const { error } = await supabase
    .from('pr_session_tunes')
    .delete()
    .eq('session_id', sessionId)
    .eq('repertoire_id', repertoireId);

  if (error) throw new Error(`Could not remove the mark: ${error.message}`);

  try {
    await recomputeLastPracticed(repertoireId);
  } catch (recomputeError) {
    const detail = recomputeError instanceof Error ? recomputeError.message : String(recomputeError);
    throw new Error(
      `The mark was removed, but the practice date could not be recalculated — reload the page before trusting it (${detail}).`,
    );
  }
}
