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
