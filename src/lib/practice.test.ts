/**
 * `logPractice` (#10, corte 1) con el cliente de Supabase simulado. La regla que
 * de verdad se juega algo aquí es la compensación: si la línea falla, la sesión
 * recién creada no puede quedarse vacía en el historial. También se comprueba
 * que el cliente no escribe `user_id` ni `last_practiced_at` — los pone la base.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sessionResult: { data: { id: 'session-1' }, error: null } as any,
  lineResult: { error: null } as any,
  sessionBodies: [] as any[],
  lineBodies: [] as any[],
  deleted: [] as string[],
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pr_sessions') {
        return {
          insert: (body: any) => {
            h.sessionBodies.push(body);
            return { select: () => ({ maybeSingle: async () => h.sessionResult }) };
          },
          delete: () => ({
            eq: async (_column: string, id: string) => {
              h.deleted.push(id);
              return { error: null };
            },
          }),
        };
      }
      return {
        insert: async (body: any) => {
          h.lineBodies.push(body);
          return h.lineResult;
        },
      };
    },
  },
}));

import { logPractice } from './practice';

beforeEach(() => {
  h.sessionResult = { data: { id: 'session-1' }, error: null };
  h.lineResult = { error: null };
  h.sessionBodies = [];
  h.lineBodies = [];
  h.deleted = [];
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
