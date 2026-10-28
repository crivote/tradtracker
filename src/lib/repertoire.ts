import { supabase } from './supabase';
import type { RepertoireRow } from './repertoire-model';
import { mapRepertoireRow } from './repertoire-model';

export * from './repertoire-model';

/** El join se pide con !inner para que el tune venga siempre en la misma consulta. */
const REPERTOIRE_SELECT = [
  'id',
  'status',
  'rating',
  'custom_title',
  'custom_rhythm',
  'custom_key',
  'notes',
  'added_at',
  'last_practiced_at',
  'pr_tunes!inner(id,origin,origin_ref,name,rhythm,meter,key,abc)',
].join(',');

export async function fetchRepertoire(): Promise<RepertoireRow[]> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .select(REPERTOIRE_SELECT)
    .order('added_at', { ascending: false });

  if (error) throw new Error(`Could not load your repertoire: ${error.message}`);
  return (data ?? []).map(mapRepertoireRow);
}

/** Un tune tal y como lo entrega el catálogo SQLite. */
export interface CatalogueTune {
  tuneId: number;
  name: string;
  rhythm?: string | null;
  meter?: string | null;
}

/**
 * `pr_tunes` es compartida: el tune puede existir ya porque otro usuario lo dio
 * de alta antes. `pr_tunes_select` deja leerla a cualquier autenticado, así que
 * se busca primero y solo se inserta si no está.
 */
export async function findTuneByOriginRef(originRef: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('pr_tunes')
    .select('id')
    .eq('origin', 'thesession')
    .eq('origin_ref', originRef)
    .maybeSingle();

  if (error) throw new Error(`Could not look up the tune in the catalogue: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Devuelve el uuid de `pr_tunes` para un tune del catálogo, creándolo si hace
 * falta. La identidad es `(origin='thesession', origin_ref=tune_id)` — decisión
 * D4: nada de ids prefijados.
 *
 * `created_by` se envía explícito porque la política de alta exige
 * `created_by = auth.uid()` y la columna no tiene valor por defecto. Si dos
 * usuarios dan de alta el mismo tune a la vez, el índice único responde 23505 y
 * se relee la fila del otro: el resultado es el mismo uuid, no un duplicado.
 */
export async function ensureTune(tune: CatalogueTune): Promise<string> {
  const originRef = String(tune.tuneId);

  const existing = await findTuneByOriginRef(originRef);
  if (existing) return existing;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error('Your session expired — sign in again to add tunes.');
  }

  const { data, error } = await supabase
    .from('pr_tunes')
    .insert({
      origin: 'thesession',
      origin_ref: originRef,
      name: tune.name,
      rhythm: tune.rhythm ?? null,
      meter: tune.meter ?? null,
      created_by: userData.user.id,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      const raced = await findTuneByOriginRef(originRef);
      if (raced) return raced;
    }
    throw new Error(`Could not save the tune: ${error.message}`);
  }
  if (!data?.id) throw new Error('The tune was saved but no id came back.');

  return data.id;
}

/** Alta desde el catálogo: resuelve (o crea) el tune y lo mete en el repertorio. */
export async function addCatalogueTune(tune: CatalogueTune): Promise<string> {
  const tuneId = await ensureTune(tune);
  await addToRepertoire(tuneId);
  return tuneId;
}

/**
 * No se envía user_id: la columna tiene `default auth.uid()` (migración 002) y la
 * RLS lo vuelve a comprobar. El dueño lo decide la base, no el navegador.
 */
export async function addToRepertoire(tuneId: string): Promise<void> {
  const { error } = await supabase.from('pr_repertoire').insert({ tune_id: tuneId });
  if (error) {
    if (error.code === '23505') throw new Error('That tune is already in your repertoire.');
    throw new Error(`Could not add the tune: ${error.message}`);
  }
}

export async function removeFromRepertoire(repertoireId: string): Promise<void> {
  const { error } = await supabase.from('pr_repertoire').delete().eq('id', repertoireId);
  if (error) throw new Error(`Could not remove the tune: ${error.message}`);
}
