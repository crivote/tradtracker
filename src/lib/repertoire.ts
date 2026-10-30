import { supabase } from './supabase';
import type { RepertoireRow, RepertoireStats, TuneStatus } from './repertoire-model';
import { mapRepertoireRow, mapStatsRow } from './repertoire-model';

export * from './repertoire-model';

/** El join se pide con !inner para que el tune venga siempre en la misma consulta. */
const REPERTOIRE_SELECT = [
  'id',
  'status',
  'shelved',
  'rating',
  'custom_title',
  'custom_rhythm',
  'custom_key',
  'notes',
  'added_at',
  'last_practiced_at',
  // Fondo del tune (#31): las doce columnas de la migración 005.
  'image_source',
  'image_id',
  'image_thumb_url',
  'image_full_url',
  'image_page_url',
  'image_author',
  'image_license',
  'image_license_url',
  'image_focal_x',
  'image_focal_y',
  'image_zoom',
  'image_chosen_at',
  'pr_tunes!inner(id,origin,origin_ref,name,rhythm,meter,key,abc)',
].join(',');

/** Columnas de la vista de agregados (#29); una fila por fila de repertorio. */
const STATS_SELECT = 'repertoire_id,practice_count,avg_quality,days_since_last_practice';

/**
 * Agregados de ensayo por fila de repertorio (issue #29). Van en una segunda
 * consulta y no en un join embebido porque la vista no es un destino de join
 * (no hay clave ajena de una tabla a una vista).
 *
 * Si la vista no existe o falla, se devuelve un mapa vacío y la home sigue
 * funcionando: las cartas dicen `no sessions yet`, que es la rama del «no» del
 * issue. Estimar aquí sería inventar el dato que falta.
 */
async function fetchStats(): Promise<Map<string, RepertoireStats>> {
  const { data, error } = await supabase.from('pr_repertoire_stats').select(STATS_SELECT);
  const stats = new Map<string, RepertoireStats>();
  if (error) return stats;
  for (const row of data ?? []) {
    stats.set(row.repertoire_id, mapStatsRow(row));
  }
  return stats;
}

/**
 * El repertorio entero, con sus agregados. Las dos consultas van en paralelo:
 * la lista no espera a los agregados ni al revés.
 */
export async function fetchRepertoire(): Promise<RepertoireRow[]> {
  const [{ data, error }, stats] = await Promise.all([
    supabase
      .from('pr_repertoire')
      .select(REPERTOIRE_SELECT)
      .order('added_at', { ascending: false }),
    fetchStats(),
  ]);

  if (error) throw new Error(`Could not load your repertoire: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<Record<string, any>>;
  return rows.map((row) => mapRepertoireRow(row, stats.get(row.id) ?? null));
}

/**
 * Una fila concreta del repertorio, para el detalle `/repertoire/:id` (#7).
 * `maybeSingle` porque «no existe» y «no es tuya» (RLS devuelve vacío) son el
 * mismo caso para la vista: null, sin error.
 */
export async function fetchRepertoireRow(id: string): Promise<RepertoireRow | null> {
  const [rowResult, statsResult] = await Promise.all([
    supabase.from('pr_repertoire').select(REPERTOIRE_SELECT).eq('id', id).maybeSingle(),
    supabase.from('pr_repertoire_stats').select(STATS_SELECT).eq('repertoire_id', id).maybeSingle(),
  ]);

  const { data, error } = rowResult;
  if (error) throw new Error(`Could not load that tune: ${error.message}`);
  if (!data) return null;

  const stats = statsResult.error ? null : mapStatsRow(statsResult.data);
  return mapRepertoireRow(data, stats);
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

/**
 * Lo que se guarda al elegir un fondo (#31). Son los datos del candidato más el
 * encuadre; el id del proveedor va aparte porque es lo que permite deduplicar y
 * volver a pedir el grande.
 */
export interface ImageSelection {
  source: 'commons' | 'pexels';
  id: string;
  thumbUrl: string;
  fullUrl: string;
  pageUrl: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  focalX?: number;
  focalY?: number;
  zoom?: number;
}

/** Redondeo del focal y recorte del zoom a la ventana del esquema: 0–100 y 1–2,2. */
function focalValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value as number)) return fallback;
  return Math.round(Math.min(100, Math.max(0, value as number)));
}

function zoomValue(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return 1;
  return Math.min(2.2, Math.max(1, value as number));
}

/**
 * Guarda la elección en la fila de repertorio. Se escribe **por id de fila**: la
 * fila ya existe (estamos en su detalle) y `user_id` lo pone la base, igual que
 * en el alta. Un `upsert` no serviría: la rama de inserción necesitaría
 * `tune_id` y podría crear una fila fantasma. El `select('id')` convierte un
 * no-op silencioso (fila ajena por RLS) en error visible.
 */
export async function saveImageChoice(
  repertoireId: string,
  selection: ImageSelection
): Promise<void> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .update({
      image_source: selection.source,
      image_id: selection.id,
      image_thumb_url: selection.thumbUrl,
      image_full_url: selection.fullUrl,
      image_page_url: selection.pageUrl,
      image_author: selection.author,
      image_license: selection.license,
      image_license_url: selection.licenseUrl,
      image_focal_x: focalValue(selection.focalX, 50),
      image_focal_y: focalValue(selection.focalY, 50),
      image_zoom: zoomValue(selection.zoom),
      image_chosen_at: new Date().toISOString(),
    })
    .eq('id', repertoireId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Could not save the background: ${error.message}`);
  if (!data?.id) throw new Error('Could not save the background: that tune is not yours.');
}

/**
 * Quita el fondo y deja los valores por defecto del esquema (centro y 100 %),
 * para que volver a elegir no herede el encuadre de la imagen anterior.
 */
export async function clearImageChoice(repertoireId: string): Promise<void> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .update({
      image_source: null,
      image_id: null,
      image_thumb_url: null,
      image_full_url: null,
      image_page_url: null,
      image_author: null,
      image_license: null,
      image_license_url: null,
      image_focal_x: 50,
      image_focal_y: 50,
      image_zoom: 1,
      image_chosen_at: null,
    })
    .eq('id', repertoireId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Could not clear the background: ${error.message}`);
  if (!data?.id) throw new Error('Could not clear the background: that tune is not yours.');
}

/**
 * Cambia el peldaño de capacidad (#11). Se envía **solo** `status`: el CHECK de
 * la migración 006 valida los cuatro valores y el trigger
 * `pr_repertoire_touch_trg` mantiene `status_changed_at`. Escribir esa columna
 * desde el navegador sería fechar el cambio con el reloj del cliente.
 *
 * Mismo patrón que `saveImageChoice`: se actualiza por id de fila y se pide el
 * id de vuelta, porque a una fila ajena la filtra la RLS y el `update` no da
 * error, solo deja de afectar filas —un no-op silencioso que el `select` sí
 * convierte en error visible—.
 */
export async function saveStatus(repertoireId: string, status: TuneStatus): Promise<void> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .update({ status })
    .eq('id', repertoireId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Could not save the level: ${error.message}`);
  if (!data?.id) throw new Error('Could not save the level: that tune is not yours.');
}

/**
 * Marca o desmarca la aparcada (#11). El peldaño no se toca: aparcar es una
 * bandera transversal y una tune aparcada conserva el suyo. Nunca se envía
 * `user_id`; el dueño lo decide la base.
 */
export async function saveShelved(repertoireId: string, shelved: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('pr_repertoire')
    .update({ shelved })
    .eq('id', repertoireId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Could not save the shelved flag: ${error.message}`);
  if (!data?.id) throw new Error('Could not save the shelved flag: that tune is not yours.');
}
