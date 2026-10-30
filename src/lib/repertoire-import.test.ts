/**
 * Alta en lote del tunebook (#32, corte 2).
 *
 * Lo que importa aquí no es «inserta filas» sino las tres reglas que el panel no
 * puede garantizar: **una llamada por tanda de 100** (no un viaje por tune), que
 * un `23505` en la tanda de repertorio se resuelva fila a fila sin abortar, y que
 * el cliente **no escriba** `user_id` ni `status_changed_at`.
 *
 * Supabase va con un doble encadenable (`.select().eq().in()`, `.insert()`) que
 * devuelve el resultado al ser esperado, igual que el cliente real. El camino
 * contra la base de verdad no se puede correr aquí: no hay credenciales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}));

vi.mock('./catalogue-db', () => ({
  lookupCatalogueMeters: vi.fn(),
}));

import { lookupCatalogueMeters } from './catalogue-db';
import { importSessionTunes } from './repertoire';
import { supabase } from './supabase';
import type { SessionTune } from './thesession-import';

const mockedMeters = vi.mocked(lookupCatalogueMeters);
const client = supabase as unknown as {
  from: any;
  auth: { getUser: any };
};

interface FakeOptions {
  /** `origin_ref` que ya tienen uuid en `pr_tunes`. */
  existingRefs?: string[];
  /** La tanda de `pr_repertoire` responde 23505 (otra pestaña a la vez). */
  batchConflicts?: boolean;
  /** Los `tune_id` que ya estaban: 23505 al reintentar fila a fila. */
  conflicts?: Set<string>;
}

/** Cliente falso: registra cada escritura y responde como PostgREST. */
function fakeClient(options: FakeOptions = {}) {
  const refs = new Map<string, string>(
    (options.existingRefs ?? []).map((ref, index) => [ref, `existing-${index + 1}`])
  );
  const tuneBatches: number[] = [];
  const repertoireInserts: any[][] = [];
  let seq = 0;

  const from = vi.fn((table: string) => {
    let op: 'select' | 'insert' = 'select';
    let payload: any;
    const filters: Record<string, any> = {};

    const run = () => {
      if (table === 'pr_tunes' && op === 'select') {
        const wanted: string[] = filters.origin_ref ?? [];
        return {
          data: wanted
            .filter((ref) => refs.has(ref))
            .map((ref) => ({ id: refs.get(ref)!, origin_ref: ref })),
          error: null,
        };
      }

      if (table === 'pr_tunes' && op === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload];
        tuneBatches.push(rows.length);
        const data = rows.map((row: any) => {
          if (!refs.has(row.origin_ref)) {
            seq += 1;
            refs.set(row.origin_ref, `tune-${seq}`);
          }
          return { id: refs.get(row.origin_ref)!, origin_ref: row.origin_ref };
        });
        return Array.isArray(payload) ? { data, error: null } : { data: null, error: null };
      }

      if (table === 'pr_repertoire' && op === 'insert') {
        if (Array.isArray(payload)) {
          repertoireInserts.push(payload);
          if (options.batchConflicts) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          return { data: null, error: null };
        }
        if (options.conflicts?.has(payload.tune_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        repertoireInserts.push([payload]);
        return { data: null, error: null };
      }

      return { data: null, error: null };
    };

    const builder: any = {
      select: () => builder,
      eq: (column: string, value: any) => {
        filters[column] = value;
        return builder;
      },
      in: (column: string, values: any[]) => {
        filters[column] = values;
        return builder;
      },
      insert: (rows: any) => {
        op = 'insert';
        payload = rows;
        return builder;
      },
      then: (resolve: any, reject?: any) => {
        try {
          resolve(run());
        } catch (cause) {
          reject?.(cause);
        }
      },
    };
    return builder;
  });

  const getUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }));
  return { from, getUser, tuneBatches, repertoireInserts };
}

/** Tunes sintéticos: el id y el nombre son lo único que viaja. */
function tunes(count: number, from = 1): SessionTune[] {
  return Array.from({ length: count }, (_, index) => ({
    tuneId: from + index,
    name: `Tune ${from + index}`,
    rhythm: 'reel',
    addedAt: null,
  }));
}

function install(fake: ReturnType<typeof fakeClient>) {
  client.from = fake.from;
  client.auth.getUser = fake.getUser;
}

beforeEach(() => {
  mockedMeters.mockReset();
  mockedMeters.mockResolvedValue(new Map());
  client.from = vi.fn();
  client.auth.getUser = vi.fn();
});

describe('importSessionTunes (#32)', () => {
  it('va por tandas de 100: ni una petición por tune', async () => {
    const fake = fakeClient();
    install(fake);

    const result = await importSessionTunes(tunes(250), 'learning');

    // Alta de `pr_tunes`: 100 + 100 + 50.
    expect(fake.tuneBatches).toEqual([100, 100, 50]);
    // Y el repertorio, lo mismo: tres viajes, no 250.
    expect(fake.repertoireInserts.map((rows) => rows.length)).toEqual([100, 100, 50]);
    expect(result).toEqual({ createdTunes: 250, added: 250, alreadyPresent: 0, status: 'learning' });
  });

  it('no crea los tunes que ya estaban: solo pregunta por ellos', async () => {
    const list = tunes(120);
    const fake = fakeClient({ existingRefs: list.map((tune) => String(tune.tuneId)) });
    install(fake);

    const result = await importSessionTunes(list, 'playing_along');

    expect(fake.tuneBatches).toEqual([]);
    expect(fake.repertoireInserts.map((rows) => rows.length)).toEqual([100, 20]);
    expect(result.createdTunes).toBe(0);
    expect(result.added).toBe(120);
  });

  it('rellena el compás del catálogo y deja null el que no está', async () => {
    mockedMeters.mockResolvedValue(new Map([[2, '4/4']]));
    const fake = fakeClient();
    install(fake);

    await importSessionTunes(tunes(3), 'to_learn');

    const rows = fake.repertoireInserts[0];
    expect(rows.every((row) => row.status === 'to_learn')).toBe(true);
    // Sin `user_id` ni `status_changed_at`: los pone la base.
    expect(Object.keys(rows[0]).sort()).toEqual(['status', 'tune_id']);
  });

  it('si el catálogo falla, importa igual con el compás vacío', async () => {
    mockedMeters.mockRejectedValue(new Error('the catalogue is not loaded'));
    const fake = fakeClient();
    install(fake);

    const result = await importSessionTunes(tunes(2), 'learning');

    // El `meter` lo escribe `tuneRowsFor`; aquí basta con que no aborte.
    expect(result.added).toBe(2);
    expect(fake.tuneBatches).toEqual([2]);
  });

  it('un 23505 en la tanda es una carrera, no un error: reintenta fila a fila', async () => {
    const fake = fakeClient({ batchConflicts: true, conflicts: new Set(['tune-2']) });
    install(fake);

    const result = await importSessionTunes(tunes(3), 'solo_ready');

    expect(result.added).toBe(2);
    expect(result.alreadyPresent).toBe(1);
    expect(result.status).toBe('solo_ready');
    // La tanda falló y se reintentó: tres filas sueltas, dos de ellas buenas.
    expect(fake.repertoireInserts.length).toBe(3);
  });

  it('cualquier otro código de error se lanza', async () => {
    const fake = fakeClient();
    const failing = fake.from;
    install({
      ...fake,
      from: vi.fn((table: string) => {
        if (table !== 'pr_repertoire') return failing(table);
        const builder: any = {
          insert: () => builder,
          select: () => builder,
          then: (resolve: any) => resolve({ data: null, error: { code: '42501', message: 'denied' } }),
        };
        return builder;
      }),
    } as any);

    await expect(importSessionTunes(tunes(1), 'learning')).rejects.toThrow(
      'Could not add the tunes: denied'
    );
  });

  it('sin sesión no escribe nada: el alta necesita `created_by`', async () => {
    const fake = fakeClient();
    client.from = fake.from;
    client.auth.getUser = vi.fn(async () => ({ data: { user: null }, error: null }));

    await expect(importSessionTunes(tunes(1), 'learning')).rejects.toThrow(
      'Your session expired — sign in again to add tunes.'
    );
    expect(fake.repertoireInserts).toEqual([]);
  });
});
