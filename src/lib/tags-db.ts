/**
 * Adaptador Supabase del vocabulario y las asignaciones de etiquetas (F17, #48).
 * La vista no habla con el cliente: todo lo que cruza la red vive aquí.
 *
 * Reglas que el esquema impone y este módulo respeta:
 *   · El vocabulario (`pr_tag_facets`, `pr_tags`) lo lee cualquier usuario
 *     autenticado y **no** lo escribe el cliente.
 *   · Marcar siembra ancestros: lo hace `pr_tag_with_ancestors` en la base, en
 *     una sola llamada para N tunes. El cliente no calcula el árbol al escribir.
 *   · Quitar una etiqueta quita **solo** esa: desmarcar `donegal` deja `ireland`.
 *   · `user_id` no viaja nunca como parámetro: sale de la sesión.
 *   · `dismissed` es de las etiquetas compartidas (v2) y aquí ni se lee.
 */
import { supabase } from './supabase';
import type { Tag, TagFacetInfo } from './tags';

/**
 * PostgREST arma un `in.(…)` por cada valor, y 300 uuid en una sola URL pasan de
 * 13 KB: por encima de esta tanda el filtro se trocea en varias llamadas. Lo
 * normal —las asignaciones de una visita al detalle, o las de una pantalla— cabe
 * en una.
 */
const TUNE_BATCH = 100;

export interface TagVocabulary {
  facets: TagFacetInfo[];
  tags: Tag[];
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * El vocabulario completo. `multiple` existe en `pr_tag_facets` pero no se pide:
 * hoy vale `true` en las tres facetas y la UI no tiene lector para ella —todo son
 * casillas, no hay rama de radios—.
 */
export async function fetchVocabulary(): Promise<TagVocabulary> {
  const [facetsResult, tagsResult] = await Promise.all([
    supabase.from('pr_tag_facets').select('id,label,sort'),
    supabase.from('pr_tags').select('id,facet,value,label,parent,sort'),
  ]);

  const { data: facets, error: facetsError } = facetsResult;
  if (facetsError) {
    throw new Error(`Could not load the tag facets: ${facetsError.message}`);
  }

  const { data: tags, error: tagsError } = tagsResult;
  if (tagsError) throw new Error(`Could not load the tags: ${tagsError.message}`);

  return {
    facets: (facets ?? []) as TagFacetInfo[],
    tags: (tags ?? []) as Tag[],
  };
}

/**
 * Las filas de `pr_user_tune_tags` de estas tunes, troceadas en tandas de 100.
 * Sin tunes no se llama a la red: el caso «no hay nada que pintar» no cuesta una
 * petición.
 */
export async function fetchTuneTags(
  tuneIds: string[]
): Promise<{ tune_id: string; tag_id: number }[]> {
  const rows: { tune_id: string; tag_id: number }[] = [];

  for (const batch of batches(tuneIds, TUNE_BATCH)) {
    const { data, error } = await supabase
      .from('pr_user_tune_tags')
      .select('tune_id,tag_id')
      .in('tune_id', batch);

    if (error) throw new Error(`Could not load the tags of those tunes: ${error.message}`);
    rows.push(...((data ?? []) as { tune_id: string; tag_id: number }[]));
  }

  return rows;
}

/**
 * Asigna etiquetas a N tunes en una llamada. La base inserta además los
 * ancestros de cada etiqueta (`donegal` entra con `ireland`) y es idempotente, así
 * que repetir la llamada no duplica nada. Devuelve cuántas filas nuevas escribió.
 *
 * Con cualquiera de los dos arrays vacío no se llama: la RPC no tiene nada que
 * hacer y un viaje de red por nada es un fallo silencioso esperando a ocurrir.
 */
export async function addTuneTags(tuneIds: string[], tagIds: number[]): Promise<number> {
  if (tuneIds.length === 0 || tagIds.length === 0) return 0;

  const { data, error } = await supabase.rpc('pr_tag_with_ancestors', {
    p_tune_ids: tuneIds,
    p_tag_ids: tagIds,
  });

  if (error) throw new Error(`Could not add the tags: ${error.message}`);
  return (data as number | null) ?? 0;
}

/**
 * Quita UNA etiqueta de UNA tune. No toca los ancestros —quitar `donegal` deja
 * `ireland`—: esa asimetría es deliberada, no un olvido.
 *
 * El dueño sale de la sesión (`auth.getUser()`), nunca de un parámetro: el
 * cliente no inventa el `user_id`. Mismo patrón que `saveStatus`: si la fila no
 * es del usuario, la RLS la filtra sin error y el borrado no afecta a nada; aquí
 * no se convierte ese no-op en error porque «ya no estaba» es un desenlace
 * legítimo (doble clic, estado viejo) y la pantalla relee después.
 */
export async function removeTuneTag(tuneId: string, tagId: number): Promise<void> {
  const { data: session, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !session.user) {
    throw new Error('Could not remove the tag: your session expired — sign in again.');
  }

  const { error } = await supabase
    .from('pr_user_tune_tags')
    .delete()
    .eq('tune_id', tuneId)
    .eq('tag_id', tagId)
    .eq('user_id', session.user.id);

  if (error) throw new Error(`Could not remove the tag: ${error.message}`);
}
