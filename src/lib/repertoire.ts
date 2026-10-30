import { supabase } from './supabase';
import type { RepertoireRow, RepertoireStats, TuneStatus } from './repertoire-model';
import { mapRepertoireRow, mapStatsRow } from './repertoire-model';
import { lookupCatalogueMeters } from './catalogue-db';
import {
  repertoireRowsFor,
  tuneRowsFor,
  type RepertoireInsertRow,
  type SessionTune,
  type TuneInsertRow,
} from './thesession-import';

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

/* ── import del tunebook de The Session (#32, corte 2) ─────────────── */

/**
 * Lo que devuelve un alta en lote. Los tres recuentos no son adorno: el panel
 * enseña «K tunes added» con `added` y nombra aparte lo que ya estaba, porque
 * una importación de 400 tunes se repite y el segundo viaje no crea nada.
 */
export interface SessionImportResult {
  /** Filas nuevas en `pr_tunes` (compartida: puede no crear ninguna). */
  createdTunes: number;
  /** Filas nuevas en `pr_repertoire`. */
  added: number;
  /** Ya presentes en el repertorio (carrera con otra pestaña, 23505). */
  alreadyPresent: number;
  /** El peldaño con el que se dieron de alta. */
  status: string;
}

/** Tanda de escritura: 100 filas por viaje, ni una petición por tune. */
const IMPORT_BATCH = 100;

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * Alta en lote del tunebook (#32): resuelve o crea los `pr_tunes` que falten y
 * cuelga de ellos las filas de repertorio, **por tandas de 100**.
 *
 * El orden y las trampas:
 *   1. El `meter` sale del catálogo local. Si el catálogo no está cargado o la
 *      consulta falla, se sigue con un mapa vacío: el compás queda `null` y el
 *      tune entra igual — no se pierde una importación de 400 por un adorno.
 *   2. `pr_tunes` es compartida: se pregunta qué `origin_ref` ya tienen uuid
 *      antes de insertar (la columna es `text`, de ahí `String`).
 *   3. Los que faltan se insertan de una tanda en una llamada; después se
 *      releen los que sigan sin uuid, que es la carrera con otro usuario. Si la
 *      tanda choca con un `23505` (alguien insertó una de las cien a la vez) se
 *      reintenta fila a fila: un viaje por tune **solo** en ese caso, porque la
 *      alternativa es perder las otras noventa y nueve.
 *   4. Las filas de repertorio también van por tandas. Un `23505` en la tanda
 *      significa «otra pestaña lo insertó a la vez»: se reintenta fila a fila
 *      ignorando los duplicados, porque el resultado final es el mismo. Otro
 *      código se lanza.
 *   5. `user_id`, `status_changed_at` y `last_practiced_at` **no** se escriben:
 *      los pone la base (default `auth.uid()` y trigger).
 */
export async function importSessionTunes(
  tunes: SessionTune[],
  status: string,
  onProgress?: (done: number, total: number) => void
): Promise<SessionImportResult> {
  const total = tunes.length;
  let added = 0;
  let alreadyPresent = 0;
  let createdTunes = 0;
  let done = 0;

  if (total === 0) return { createdTunes, added, alreadyPresent, status };

  // 1. Compás del catálogo local; sin catálogo, `meter: null`.
  let meters = new Map<number, string | null>();
  try {
    meters = await lookupCatalogueMeters(tunes.map((tune) => tune.tuneId));
  } catch {
    /* el catálogo es un adorno del alta: no aborta la importación */
  }

  // 2. Qué `origin_ref` ya tienen uuid en `pr_tunes`.
  const tuneIdByRef = new Map<string, string>();
  const collect = (rows: Array<{ id: string; origin_ref: string | null }>) => {
    for (const row of rows) {
      if (row.origin_ref) tuneIdByRef.set(String(row.origin_ref), row.id);
    }
  };

  const lookupRefs = async (refs: string[]) => {
    for (const batch of batches(refs, IMPORT_BATCH)) {
      const { data, error } = await supabase
        .from('pr_tunes')
        .select('id,origin_ref')
        .eq('origin', 'thesession')
        .in('origin_ref', batch);

      if (error) throw new Error(`Could not look up the tunes: ${error.message}`);
      collect((data ?? []) as Array<{ id: string; origin_ref: string | null }>);
    }
  };

  await lookupRefs(tunes.map((tune) => String(tune.tuneId)));

  // 3. Alta de los `pr_tunes` que falten.
  const missing = tunes.filter((tune) => !tuneIdByRef.has(String(tune.tuneId)));
  if (missing.length > 0) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('Your session expired — sign in again to add tunes.');
    }
    const createdBy = userData.user.id;

    const insertOne = async (row: TuneInsertRow & { created_by: string }): Promise<boolean> => {
      const { error } = await supabase.from('pr_tunes').insert(row);
      if (!error) return true;
      // Otro usuario la creó entre la lectura y la escritura: no es un fallo.
      if (error.code === '23505') return false;
      throw new Error(`Could not save the tunes: ${error.message}`);
    };

    for (const batch of batches(missing, IMPORT_BATCH)) {
      const rows = tuneRowsFor(batch, meters).map((row) => ({ ...row, created_by: createdBy }));

      const { data, error } = await supabase
        .from('pr_tunes')
        .insert(rows)
        .select('id,origin_ref');

      if (error) {
        if (error.code !== '23505') {
          throw new Error(`Could not save the tunes: ${error.message}`);
        }
        // Una de las cien chocó: se reintenta fila a fila y se ignoran los
        // duplicados; los uuid se recogen en la relectura de abajo.
        for (const row of rows) {
          createdTunes += (await insertOne(row)) ? 1 : 0;
        }
        continue;
      }

      const inserted = (data ?? []) as Array<{ id: string; origin_ref: string | null }>;
      collect(inserted);
      createdTunes += inserted.length;
    }

    // 4. Relectura de los que sigan sin uuid (carrera con otro usuario).
    const stillMissing = tunes
      .filter((tune) => !tuneIdByRef.has(String(tune.tuneId)))
      .map((tune) => String(tune.tuneId));
    if (stillMissing.length > 0) await lookupRefs(stillMissing);

    const unresolved = tunes.filter((tune) => !tuneIdByRef.has(String(tune.tuneId)));
    if (unresolved.length > 0) {
      // Sin uuid no hay clave ajena que colgar: decirlo en vez de contar de más.
      throw new Error(
        `Could not resolve ${unresolved.length} of the tunes in the shared catalogue — nothing was added to your repertoire.`
      );
    }
  }

  // 5. Filas de repertorio, tantas como tunes tengan uuid.
  const rows = repertoireRowsFor(tunes, tuneIdByRef, status);
  const insertRow = async (row: RepertoireInsertRow): Promise<void> => {
    const { error } = await supabase.from('pr_repertoire').insert(row);
    if (!error) {
      added += 1;
      return;
    }
    if (error.code === '23505') {
      alreadyPresent += 1;
      return;
    }
    throw new Error(`Could not add the tunes: ${error.message}`);
  };

  for (const batch of batches(rows, IMPORT_BATCH)) {
    const { error } = await supabase.from('pr_repertoire').insert(batch);

    if (!error) {
      added += batch.length;
    } else if (error.code === '23505') {
      // Otra pestaña insertó alguna a la vez: fila a fila, los duplicados no
      // son un error. El resultado final es el mismo.
      for (const row of batch) await insertRow(row);
    } else {
      throw new Error(`Could not add the tunes: ${error.message}`);
    }

    done += batch.length;
    onProgress?.(Math.min(done, total), total);
  }

  return { createdTunes, added, alreadyPresent, status };
}
