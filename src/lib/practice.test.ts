/**
 * Capa de datos de la práctica con el cliente de Supabase simulado.
 *
 * Desde #56 la unidad es la **tune y el día**: una fila de `pr_practice` con
 * `unique (user_id, repertoire_id, day)`. Aquí se prueban las reglas que se
 * juegan algo:
 *   · El **día** lo compone el cliente con `todayKeyFor`: un ensayo de las 23:30
 *     locales es del día en que se tocó, no del siguiente. Nunca `toISOString`.
 *   · El **upsert** del mismo día: marcar y luego valorar deja **una** fila y
 *     actualiza la valoración.
 *   · El **desmarcado** es una sola operación: borra la fila del día **y**
 *     recalcula la fecha. Si el recálculo falla después del borrado, el error
 *     tiene que decir que la marca se quitó y que la fecha puede estar movida.
 *
 * También se comprueba que el cliente no escribe `user_id` pero **sí** el instante real del ensayo
 * (`practiced_at`: la base no puede adivinarlo en una marca retroactiva), y que `quality` sigue siendo
 * opcional y el comentario se normaliza.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** Resultado del `upsert` de `pr_practice` (por defecto, una fila con id). */
  upsertResult: { data: { id: 'practice-1' }, error: null } as any,
  /** Cuerpos de cada `upsert`, en orden. */
  upsertBodies: [] as any[],
  /** Opciones de cada `upsert` (`onConflict`), en orden. */
  upsertOptions: [] as any[],
  /** Respuesta de `fetchDayMarks`. */
  marksResult: { data: null, error: null } as any,
  marksSelect: '' as string,
  marksFilters: [] as any[],
  deleteResult: { error: null } as any,
  rpcResult: { error: null } as any,
  deletes: [] as Array<Record<string, string>>,
  rpcCalls: [] as Array<{ fn: string; args: any }>,
}));

vi.mock('./supabase', () => {
  /** Filtro de PostgREST: se anota y se sigue encadenando. */
  const filter = (log: (call: any) => void, call: any) => {
    log(call);
  };

  /**
   * Cadena de consulta: cada método devuelve la misma cadena y además es
   * `thenable`, así que `await cadena` funciona sin un `maybeSingle` explícito.
   */
  function chain(result: any, log?: (call: any) => void) {
    const self: any = {
      eq: (col: string, val: unknown) => {
        filter((call) => log?.(call), { method: 'eq', col, val });
        return self;
      },
      select: () => self,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return self;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'pr_practice') {
          throw new Error(`unexpected table in this test: ${table}`);
        }
        return {
          upsert: (body: any, options?: any) => {
            h.upsertBodies.push(body);
            h.upsertOptions.push(options);
            return chain(h.upsertResult);
          },
          select: (columns: string) => {
            h.marksSelect = columns;
            return chain(h.marksResult, (call) => h.marksFilters.push(call));
          },
          delete: () => {
            const record: Record<string, string> = {};
            const self: any = {
              eq: (col: string, val: string) => {
                record[col] = val;
                return self;
              },
              then: (resolve: any, reject: any) => {
                h.deletes.push({ ...record });
                return Promise.resolve(h.deleteResult).then(resolve, reject);
              },
            };
            return self;
          },
        };
      },
      rpc: async (fn: string, args: any) => {
        h.rpcCalls.push({ fn, args });
        return h.rpcResult;
      },
    },
  };
});

import {
  fetchDayMarks,
  logPractice,
  markPracticeDay,
  recomputeLastPractice,
  unmarkPractice,
} from './practice';
import { todayKeyFor } from './practice-storage';

beforeEach(() => {
  h.upsertResult = { data: { id: 'practice-1' }, error: null };
  h.upsertBodies = [];
  h.upsertOptions = [];
  h.marksResult = { data: null, error: null };
  h.marksSelect = '';
  h.marksFilters = [];
  h.deleteResult = { error: null };
  h.rpcResult = { error: null };
  h.deletes = [];
  h.rpcCalls = [];
});

describe('logPractice: la marca es la tune y el día', () => {
  it('hace upsert con el día local, el único que hace del día la unidad', async () => {
    await logPractice('row-a', { quality: 3, comment: '  hola  ' });

    expect(h.upsertBodies[0]).toEqual({
      repertoire_id: 'row-a',
      day: todayKeyFor(Date.now()),
      practiced_at: expect.any(String),
      quality: 3,
      comment: 'hola',
    });
    expect(h.upsertOptions[0]).toEqual({ onConflict: 'user_id,repertoire_id,day' });
    // El dueño lo pone la base; el instante no, porque en una marca retroactiva
    // el `now()` de la base sería el momento del alta y no el del ensayo.
    expect(h.upsertBodies[0].user_id).toBeUndefined();
    expect(h.upsertBodies[0].practiced_at).toBeDefined();
  });

  it('un ensayo de las 23:30 locales del día 10 es del día 10, no del 11', async () => {
    // La trampa: `new Date('2026-11-10')` y `toISOString().slice(0, 10)` leen
    // UTC, y en Madrid el día UTC ya cambió a las 23:00 locales.
    const lateNight = new Date(2026, 10, 10, 23, 30);
    await logPractice('row-a', { quality: null, comment: null }, { practicedAt: lateNight });

    expect(h.upsertBodies[0].day).toBe('2026-11-10');
    // Y el instante viaja entero: el día es para agrupar, el instante es el dato.
    expect(h.upsertBodies[0].practiced_at).toBe(lateNight.toISOString());
  });

  it('el mismo ensayo justo después de medianoche ya es del día siguiente', async () => {
    const afterMidnight = new Date(2026, 10, 11, 0, 30);
    await logPractice('row-a', { quality: null, comment: null }, { practicedAt: afterMidnight });

    expect(h.upsertBodies[0].day).toBe('2026-11-11');
  });

  it('valora con el instante recibido: `practicedAt` manda sobre el reloj', async () => {
    const at = new Date(2026, 10, 10, 9, 0);
    await logPractice('row-a', { quality: 4, comment: null }, { practicedAt: at });

    expect(h.upsertBodies[0].day).toBe(todayKeyFor(at.getTime()));
    expect(h.upsertBodies[0].quality).toBe(4);
  });

  it('manda el comentario en blanco como null y la calidad ausente como null', async () => {
    await logPractice('row-a', { quality: null, comment: '   ' });
    expect(h.upsertBodies[0].comment).toBeNull();
    expect(h.upsertBodies[0].quality).toBeNull();
  });

  it('devuelve el id de la fila que la base deja escrita', async () => {
    await expect(logPractice('row-a', { quality: 4, comment: null })).resolves.toBe('practice-1');
  });

  it('un error del upsert se lanza con el mensaje de la base', async () => {
    h.upsertResult = { data: null, error: { message: 'denied' } };

    await expect(logPractice('row-a', { quality: null, comment: null })).rejects.toThrow(
      'Could not save the practice: denied',
    );
  });

  it('si la base no devuelve id, se dice en vez de devolver vacío', async () => {
    h.upsertResult = { data: null, error: null };

    await expect(logPractice('row-a', { quality: null, comment: null })).rejects.toThrow(
      'The practice was saved but no id came back.',
    );
  });
});

describe('markPracticeDay: la tanda de la lista del día', () => {
  it('marca varias tunes de hoy en un solo viaje, sin valoración', async () => {
    const written = await markPracticeDay(['row-a', 'row-b']);

    expect(written).toBe(2);
    expect(h.upsertBodies).toHaveLength(1);
    expect(h.upsertBodies[0]).toEqual([
      { repertoire_id: 'row-a', day: todayKeyFor(Date.now()), practiced_at: expect.any(String) },
      { repertoire_id: 'row-b', day: todayKeyFor(Date.now()), practiced_at: expect.any(String) },
    ]);
    expect(h.upsertOptions[0]).toEqual({ onConflict: 'user_id,repertoire_id,day' });
    // Marcar no puntúa y no pisa lo que ya estuviera valorado: el cuerpo no
    // lleva `quality` ni `comment`, así que el `DO UPDATE` no los toca.
    expect(h.upsertBodies[0][0].quality).toBeUndefined();
    expect(h.upsertBodies[0][0].comment).toBeUndefined();
  });

  it('no repite un id en el cuerpo: el `ON CONFLICT` no puede tocar dos veces la misma fila', async () => {
    await markPracticeDay(['row-a', 'row-a', 'row-b']);

    expect(h.upsertBodies[0].map((row: any) => row.repertoire_id)).toEqual(['row-a', 'row-b']);
  });

  it('sin marcas no escribe nada', async () => {
    await expect(markPracticeDay([])).resolves.toBe(0);
    expect(h.upsertBodies).toEqual([]);
  });

  it('un error del upsert se lanza', async () => {
    h.upsertResult = { data: null, error: { message: 'nope' } };

    await expect(markPracticeDay(['row-a'])).rejects.toThrow(
      'Could not save the practice: nope',
    );
  });
});

describe('fetchDayMarks: lo marcado de un día', () => {
  it('lee las marcas del día, por día y sin adivinar fechas', async () => {
    h.marksResult = {
      data: [{ repertoire_id: 'row-a' }, { repertoire_id: 'row-b' }],
      error: null,
    };

    await expect(fetchDayMarks('2026-11-10')).resolves.toEqual(['row-a', 'row-b']);
    expect(h.marksSelect).toBe('repertoire_id');
    expect(h.marksFilters).toEqual([{ method: 'eq', col: 'day', val: '2026-11-10' }]);
  });

  it('un día sin marcas marca vacío y no revienta', async () => {
    h.marksResult = { data: [], error: null };
    await expect(fetchDayMarks('2026-11-10')).resolves.toEqual([]);

    h.marksResult = { data: null, error: null };
    await expect(fetchDayMarks('2026-11-10')).resolves.toEqual([]);
  });

  it('descarta filas sin id en vez de devolver huecos', async () => {
    h.marksResult = {
      data: [{ repertoire_id: 'row-a' }, { repertoire_id: null }, {}],
      error: null,
    };
    await expect(fetchDayMarks('2026-11-10')).resolves.toEqual(['row-a']);
  });

  it('el error de la consulta se lanza con contexto', async () => {
    h.marksResult = { data: null, error: { message: 'boom' } };
    await expect(fetchDayMarks('2026-11-10')).rejects.toThrow(
      'Could not load the practice marks: boom',
    );
  });
});

describe('recomputeLastPractice', () => {
  it('llama a la RPC nueva, la que lee marcas y no sesiones', async () => {
    await recomputeLastPractice('row-a');

    expect(h.rpcCalls).toEqual([
      { fn: 'pr_recompute_last_practice', args: { p_repertoire_id: 'row-a' } },
    ]);
  });

  it('el error de la RPC se lanza con contexto', async () => {
    h.rpcResult = { error: { message: 'function not found' } };
    await expect(recomputeLastPractice('row-a')).rejects.toThrow(
      'Could not recompute the practice date: function not found',
    );
  });
});

describe('unmarkPractice: quitar la marca de un día', () => {
  it('borra la fila de esa tune y ese día, y recalcula la fecha', async () => {
    await unmarkPractice('row-a', '2026-11-10');

    expect(h.deletes).toEqual([{ repertoire_id: 'row-a', day: '2026-11-10' }]);
    expect(h.rpcCalls).toEqual([
      { fn: 'pr_recompute_last_practice', args: { p_repertoire_id: 'row-a' } },
    ]);
  });

  it('borrar la marca más reciente puede mover la fecha atrás: el recálculo va después', async () => {
    await unmarkPractice('row-a', '2026-11-10');

    // Sin el recálculo el trigger —que solo avanza— dejaría la fecha en el día
    // borrado y la tune fuera del radar dos meses.
    expect(h.deletes).toHaveLength(1);
    expect(h.rpcCalls[0].fn).toBe('pr_recompute_last_practice');
  });

  it('si el borrado falla, no recalcula y lanza', async () => {
    h.deleteResult = { error: { message: 'denied' } };

    await expect(unmarkPractice('row-a', '2026-11-10')).rejects.toThrow(
      'Could not remove the mark: denied',
    );
    expect(h.rpcCalls).toEqual([]);
  });

  it('si el recálculo falla tras el borrado, el error lo dice y pide recargar', async () => {
    h.rpcResult = { error: { message: 'function not found' } };

    const failure = unmarkPractice('row-a', '2026-11-10');
    await expect(failure).rejects.toThrow(/The mark was removed/);
    await expect(failure).rejects.toThrow(/reload the page/);
    // El borrado sí ocurrió: la marca ya no está y la fecha puede estar movida.
    expect(h.deletes).toEqual([{ repertoire_id: 'row-a', day: '2026-11-10' }]);
  });
});
