import { normalizeTitle } from './format';

/**
 * Modelo puro del repertorio: tipos, normalización de la fila que devuelve
 * PostgREST y presentación. Sin cliente Supabase, para poder probarlo sin red.
 */

export type TuneStatus = 'nueva' | 'aprendiendo' | 'media' | 'afianzada' | 'aparcada';

export interface TuneRecord {
  id: string;
  origin: string;
  origin_ref: string | null;
  name: string;
  rhythm: string | null;
  meter: string | null;
  key: string | null;
  abc: string | null;
}

export interface RepertoireRow {
  id: string;
  status: TuneStatus;
  rating: number | null;
  custom_title: string | null;
  custom_rhythm: string | null;
  custom_key: string | null;
  notes: string | null;
  added_at: string;
  last_practiced_at: string | null;
  tune: TuneRecord;
}

/**
 * PostgREST devuelve la relación embebida como objeto (many-to-one) o como array
 * según la forma del join; aquí se normaliza a un único TuneRecord.
 */
export function mapRepertoireRow(row: Record<string, any>): RepertoireRow {
  const embedded = Array.isArray(row.pr_tunes) ? row.pr_tunes[0] : row.pr_tunes;
  if (!embedded) {
    throw new Error(`Repertoire row ${row.id} came back without its tune.`);
  }
  return {
    id: row.id,
    status: row.status as TuneStatus,
    rating: row.rating ?? null,
    custom_title: row.custom_title ?? null,
    custom_rhythm: row.custom_rhythm ?? null,
    custom_key: row.custom_key ?? null,
    notes: row.notes ?? null,
    added_at: row.added_at,
    last_practiced_at: row.last_practiced_at ?? null,
    tune: embedded as TuneRecord,
  };
}

export function displayTitle(item: RepertoireRow): string {
  return item.custom_title?.trim() || normalizeTitle(item.tune.name);
}

export function displayRhythm(item: RepertoireRow): string {
  return item.custom_rhythm?.trim() || item.tune.rhythm || '—';
}

export function displayKey(item: RepertoireRow): string {
  return item.custom_key?.trim() || item.tune.key || '—';
}

export const STATUS_LABELS: Record<TuneStatus, string> = {
  nueva: 'New',
  aprendiendo: 'Learning',
  media: 'Fluent',
  afianzada: 'Solid',
  aparcada: 'Shelved',
};

export const STATUS_STYLES: Record<TuneStatus, string> = {
  nueva: 'bg-sky-900/60 text-sky-300 border-sky-700',
  aprendiendo: 'bg-amber-900/60 text-amber-300 border-amber-700',
  media: 'bg-violet-900/60 text-violet-300 border-violet-700',
  afianzada: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
  aparcada: 'bg-gray-800 text-gray-400 border-gray-600',
};
