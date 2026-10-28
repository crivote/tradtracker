import { supabase } from './supabase';
import type { RepertoireRow, TuneRecord } from './repertoire-model';
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

const TUNE_SELECT = 'id,origin,origin_ref,name,rhythm,meter,key,abc';

export async function fetchRepertoire(): Promise<RepertoireRow[]> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .select(REPERTOIRE_SELECT)
    .order('added_at', { ascending: false });

  if (error) throw new Error(`Could not load your repertoire: ${error.message}`);
  return (data ?? []).map(mapRepertoireRow);
}

export async function fetchCatalogue(): Promise<TuneRecord[]> {
  const { data, error } = await supabase
    .from('pr_tunes')
    .select(TUNE_SELECT)
    .order('name', { ascending: true });

  if (error) throw new Error(`Could not load the tune catalogue: ${error.message}`);
  return (data ?? []) as TuneRecord[];
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
