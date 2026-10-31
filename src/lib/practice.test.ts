/**
 * Capa de datos de la práctica con el cliente de Supabase simulado.
 *
 * Dos reglas se juegan algo aquí y por eso están probadas:
 *   · La **compensación** de F4: si la línea falla, la sesión recién creada no
 *     puede quedarse vacía en el historial (una sesión fantasma).
 *   · El **desmarcado** es una sola operación: borrar la línea **y** recalcular
 *     `last_practiced_at`. Si el recálculo falla después del borrado, el error
 *     tiene que decir que la marca se quitó y que la fecha puede estar movida.
 *
 * También se comprueba que el cliente no escribe `user_id` ni
 * `last_practiced_at` — los pone la base.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sessionResult: { data: { id: 'session-1' }, error: null } as any,
  /** Resultado de cada `insert` de `pr_session_tunes`, en orden; si se acaba, `lineResult`. */
  lineResults: [] as any[],
  lineResult: { error: null } as any,
  /** Respuesta de la consulta de la sesión de hoy (`findTodaySession`). */
  todaySessionResult: { data: null, error: null } as any,
  deleteResult: { error: null } as any,
  rpcResult: { error: null } as any,
  sessionBodies: [] as any[],
  lineBodies: [] as any[],
  deleted: [] as string[],
  deletes: [] as Array<Record<string, string>>,
  sessionFilters: [] as any[],
  sessionSelect: '' as string,
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
      is: (col: string, val: unknown) => {
        filter((call) => log?.(call), { method: 'is', col, val });
        return self;
      },
      gte: (col: string, val: unknown) => {
        filter((call) => log?.(call), { method: 'gte', col, val });
        return self;
      },
      order: (col: string, opts: unknown) => {
        filter((call) => log?.(call), { method: 'order', col, opts });
        return self;
      },
      limit: (n: number) => {
        filter((call) => log?.(call), { method: 'limit', n });
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
        if (table === 'pr_sessions') {
          return {
            insert: (body: any) => {
              h.sessionBodies.push(body);
              return { select: () => ({ maybeSingle: async () => h.sessionResult }) };
            },
            delete: () => {
              // `delete().eq('id', …)` — se anota al resolver, no al llamar.
              const self: any = {
                eq: (col: string, val: unknown) => {
                  if (col === 'id' && typeof val === 'string') h.deleted.push(val);
                  return self;
                },
                then: (resolve: any, reject: any) =>
                  Promise.resolve({ error: null }).then(resolve, reject),
              };
              return self;
            },
            select: (columns: string) => {
              h.sessionSelect = columns;
              return chain(h.todaySessionResult, (call) => h.sessionFilters.push(call));
            },
          };
        }

        if (table === 'pr_session_tunes') {
          return {
            insert: async (body: any) => {
              h.lineBodies.push(body);
              if (h.lineResults.length > 0) return h.lineResults.shift();
              return h.lineResult;
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
        }

        return {
          insert: async (body: any) => {
            h.lineBodies.push(body);
            return h.lineResult;
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
  addSessionMarks,
  createSessionWithMarks,
  findTodaySession,
  logPractice,
  unmarkSessionTune,
} from './practice';

beforeEach(() => {
  h.sessionResult = { data: { id: 'session-1' }, error: null };
  h.lineResults = [];
  h.lineResult = { error: null };
  h.todaySessionResult = { data: null, error: null };
  h.deleteResult = { error: null };
  h.rpcResult = { error: null };
  h.sessionBodies = [];
  h.lineBodies = [];
  h.deleted = [];
  h.deletes = [];
  h.sessionFilters = [];
  h.sessionSelect = '';
  h.rpcCalls = [];
});

describe('logPractice', () => {
  it('inserts the session with no body and then the line with the quality and comment', async () => {
    await logPractice('row-a', { quality: 3, comment: '  hola  ' });

    // Sin cuerpo: user_id y started_at los pone la base.
    expect(h.sessionBodies).toEqual([{}]);
    expect(h.lineBodies[0]).toEqual({
      session_id: 'session-1',
      repertoire_id: 'row-a',
      quality: 3,
      comment: 'hola',
    });
    // El cliente no manda lo que mantiene la base.
    expect(h.lineBodies[0].user_id).toBeUndefined();
    expect(h.lineBodies[0].last_practiced_at).toBeUndefined();
  });

  it('sends a blank comment as null', async () => {
    await logPractice('row-a', { quality: null, comment: '   ' });
    expect(h.lineBodies[0].comment).toBeNull();
    expect(h.lineBodies[0].quality).toBeNull();
  });

  it('deletes the new session and rethrows the line error', async () => {
    h.lineResult = { error: { message: 'nope' } };

    await expect(logPractice('row-a', { quality: null, comment: null })).rejects.toThrow(
      'Could not save the practice: nope'
    );

    expect(h.deleted).toEqual(['session-1']);
  });

  it('reports a failed session insert and does not try the line', async () => {
    h.sessionResult = { data: null, error: { message: 'denied' } };

    await expect(logPractice('row-a', { quality: null, comment: null })).rejects.toThrow(
      'Could not save the practice: denied'
    );

    expect(h.lineBodies).toEqual([]);
    expect(h.deleted).toEqual([]);
  });
});

describe('findTodaySession (#36)', () => {
  it('busca la sesión de hoy sin cerrar, la más reciente, con sus marcas', async () => {
    h.todaySessionResult = {
      data: {
        id: 'session-today',
        started_at: '2026-10-31T09:00:00Z',
        pr_session_tunes: [{ repertoire_id: 'row-a' }, { repertoire_id: 'row-b' }],
      },
      error: null,
    };

    const dayStart = new Date(2026, 9, 31, 0, 0).getTime();
    const session = await findTodaySession(dayStart);

    expect(session).toEqual({ sessionId: 'session-today', markedIds: ['row-a', 'row-b'] });
    // Los filtros son el contrato: día local y sesión abierta.
    expect(h.sessionSelect).toContain('pr_session_tunes(repertoire_id)');
    expect(h.sessionFilters).toEqual([
      { method: 'gte', col: 'started_at', val: new Date(dayStart).toISOString() },
      { method: 'is', col: 'ended_at', val: null },
      { method: 'order', col: 'started_at', opts: { ascending: false } },
      { method: 'limit', n: 1 },
    ]);
  });

  it('sin sesión devuelve null, no un error', async () => {
    h.todaySessionResult = { data: null, error: null };
    await expect(findTodaySession(Date.now())).resolves.toBeNull();
  });

  it('una sesión sin líneas marca vacío y no revienta', async () => {
    h.todaySessionResult = { data: { id: 's', pr_session_tunes: null }, error: null };
    await expect(findTodaySession(Date.now())).resolves.toEqual({
      sessionId: 's',
      markedIds: [],
    });
  });

  it('el error de la consulta se lanza con contexto', async () => {
    h.todaySessionResult = { data: null, error: { message: 'boom' } };
    await expect(findTodaySession(Date.now())).rejects.toThrow(
      "Could not load today's practice: boom"
    );
  });
});

describe('createSessionWithMarks (#36)', () => {
  it('abre la sesión sin cuerpo y cuelga la primera tanda con calidad null', async () => {
    const id = await createSessionWithMarks([
      { repertoireId: 'row-a', position: 0 },
      { repertoireId: 'row-b', position: 3 },
    ]);

    expect(id).toBe('session-1');
    expect(h.sessionBodies).toEqual([{}]);
    expect(h.lineBodies[0]).toEqual([
      { session_id: 'session-1', repertoire_id: 'row-a', quality: null, position: 0 },
      { session_id: 'session-1', repertoire_id: 'row-b', quality: null, position: 3 },
    ]);
    // El trigger mueve la fecha; el cliente no la escribe.
    expect(h.lineBodies[0][0].last_practiced_at).toBeUndefined();
    expect(h.lineBodies[0][0].user_id).toBeUndefined();
  });

  it('si la línea falla, borra la sesión recién creada y lanza el error', async () => {
    h.lineResult = { error: { message: 'nope' } };

    await expect(createSessionWithMarks([{ repertoireId: 'row-a', position: 0 }])).rejects.toThrow(
      'Could not save the practice: nope'
    );

    expect(h.deleted).toEqual(['session-1']);
  });

  it('no abre sesión vacía: sin marcas es un error, no una sesión fantasma', async () => {
    await expect(createSessionWithMarks([])).rejects.toThrow(
      'A practice session needs at least one tune.'
    );
    expect(h.sessionBodies).toEqual([]);
  });
});

describe('addSessionMarks (#36)', () => {
  it('la tanda va en un viaje y devuelve cuántas escribió', async () => {
    const written = await addSessionMarks('session-1', [
      { repertoireId: 'row-a', position: 0 },
      { repertoireId: 'row-b', position: 1 },
    ]);

    expect(written).toBe(2);
    expect(h.lineBodies).toHaveLength(1);
    expect(h.lineBodies[0]).toHaveLength(2);
  });

  it('sin marcas no escribe nada', async () => {
    await expect(addSessionMarks('session-1', [])).resolves.toBe(0);
    expect(h.lineBodies).toEqual([]);
  });

  it('tolera un 23505 fila a fila y cuenta solo lo que de verdad escribió', async () => {
    // La tanda choca entera (otra pestaña marcó una), después fila a fila:
    // la repetida se ignora y las demás entran.
    h.lineResults = [
      { error: { code: '23505', message: 'duplicate key' } },
      { error: null },
      { error: { code: '23505', message: 'duplicate key' } },
      { error: null },
    ];

    const written = await addSessionMarks('session-1', [
      { repertoireId: 'row-a', position: 0 },
      { repertoireId: 'row-b', position: 1 },
      { repertoireId: 'row-c', position: 2 },
    ]);

    expect(written).toBe(2);
    // Un viaje de tanda y tres fila a fila.
    expect(h.lineBodies).toHaveLength(4);
    expect(h.lineBodies.slice(1).map((body: any) => body.repertoire_id)).toEqual([
      'row-a',
      'row-b',
      'row-c',
    ]);
  });

  it('un error que no es 23505 se lanza', async () => {
    h.lineResult = { error: { code: '42501', message: 'denied' } };
    await expect(
      addSessionMarks('session-1', [{ repertoireId: 'row-a', position: 0 }])
    ).rejects.toThrow('Could not save the practice: denied');
  });
});

describe('unmarkSessionTune (#36)', () => {
  it('borra la línea de esa sesión y esa tune, y recalcula la fecha', async () => {
    await unmarkSessionTune('session-1', 'row-a');

    expect(h.deletes).toEqual([{ session_id: 'session-1', repertoire_id: 'row-a' }]);
    expect(h.rpcCalls).toEqual([
      { fn: 'pr_recompute_last_practiced', args: { p_repertoire_id: 'row-a' } },
    ]);
  });

  it('si el borrado falla, no recalcula y lanza', async () => {
    h.deleteResult = { error: { message: 'denied' } };

    await expect(unmarkSessionTune('session-1', 'row-a')).rejects.toThrow(
      'Could not remove the mark: denied'
    );
    expect(h.rpcCalls).toEqual([]);
  });

  it('si el recálculo falla tras el borrado, el error lo dice y pide recargar', async () => {
    h.rpcResult = { error: { message: 'function not found' } };

    const failure = unmarkSessionTune('session-1', 'row-a');
    await expect(failure).rejects.toThrow(/The mark was removed/);
    await expect(failure).rejects.toThrow(/reload the page/);
    // El borrado sí ocurrió: la marca ya no está y la fecha puede estar movida.
    expect(h.deletes).toEqual([{ session_id: 'session-1', repertoire_id: 'row-a' }]);
  });
});
