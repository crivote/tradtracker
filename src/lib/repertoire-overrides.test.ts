/**
 * Escritura de overrides de metadatos (F2, #8) con el cliente de Supabase simulado.
 *
 * Tres reglas que la vista no puede garantizar y que por eso se prueban aquí:
 *   · **Un solo `update`** con todas las columnas del patch: un viaje por campo
 *     serían cuatro escrituras para un solo «Save».
 *   · **`patch` vacío no llama a Supabase** —un `update` sin columnas es un error
 *     de PostgREST— y un campo con `undefined` no cuenta como escrito.
 *   · El mapeo `title → custom_title` vive en el adaptador: la vista nunca nombra
 *     una columna.
 *
 * El camino contra la base de verdad no se corre aquí (no hay credenciales): lo
 * cubre `scripts/verify-repertoire-writes.py` de la skill, con la sesión real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fromCalls: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  eqs: [] as Array<{ col: string; val: unknown }>,
  selectCols: [] as string[],
  result: { data: { id: 'row-a' }, error: null } as any,
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      h.fromCalls.push(table);
      const chain: any = {
        update: (columns: Record<string, unknown>) => {
          h.updates.push(columns);
          return chain;
        },
        eq: (col: string, val: unknown) => {
          h.eqs.push({ col, val });
          return chain;
        },
        select: (columns: string) => {
          h.selectCols.push(columns);
          return chain;
        },
        maybeSingle: async () => h.result,
      };
      return chain;
    },
  },
}));

vi.mock('./catalogue-db', () => ({
  lookupCatalogueMeta: vi.fn(),
}));

import { saveOverrides } from './repertoire';

beforeEach(() => {
  h.fromCalls.length = 0;
  h.updates.length = 0;
  h.eqs.length = 0;
  h.selectCols.length = 0;
  h.result = { data: { id: 'row-a' }, error: null };
});

describe('saveOverrides', () => {
  it('un patch vacío no llama a Supabase', async () => {
    await saveOverrides('row-a', {});
    expect(h.fromCalls).toHaveLength(0);
  });

  it('no cuenta un campo con undefined como escrito', async () => {
    await saveOverrides('row-a', { title: undefined });
    expect(h.fromCalls).toHaveLength(0);
  });

  it('mapea los cuatro campos a sus columnas en una sola sentencia', async () => {
    await saveOverrides('row-a', {
      title: 'The Kesh',
      rhythm: 'reel',
      key: 'G',
      abc: 'X:1',
    });

    expect(h.fromCalls).toEqual(['pr_repertoire']);
    // Una escritura, cuatro columnas: el mapeo vive aquí, no en la vista.
    expect(h.updates).toEqual([
      { custom_title: 'The Kesh', custom_rhythm: 'reel', custom_key: 'G', custom_abc: 'X:1' },
    ]);
    expect(h.eqs).toEqual([{ col: 'id', val: 'row-a' }]);
    expect(h.selectCols).toEqual(['id']);
  });

  it('escribe null para volver al estándar, y solo esa columna', async () => {
    await saveOverrides('row-a', { key: null });
    expect(h.updates).toEqual([{ custom_key: null }]);
  });

  it('una fila ajena (la RLS la filtra sin error) es un error visible', async () => {
    h.result = { data: null, error: null };
    await expect(saveOverrides('row-a', { title: 'x' })).rejects.toThrow(
      'that tune is not yours'
    );
  });

  it('propaga el error de PostgREST', async () => {
    h.result = { data: null, error: { message: 'boom' } };
    await expect(saveOverrides('row-a', { title: 'x' })).rejects.toThrow('boom');
  });
});
