/**
 * Adaptador del panel (#22) con el cliente de Supabase simulado.
 *
 * Se prueban las tres cosas que el cálculo no puede garantizar: qué columnas se
 * piden (y en qué orden), el tope —que **se nota** cuando se alcanza— y que una
 * fila rota se descarta en vez de convertirse en una marca con huecos.
 *
 * El camino contra la base de verdad no se corre aquí: la suite no tiene
 * credenciales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fromCalls: [] as string[],
  selects: [] as string[],
  orders: [] as Array<{ col: string; ascending: boolean }>,
  limits: [] as number[],
  /** Respuesta de la consulta en curso. */
  result: { data: null as any, error: null as any },
}));

vi.mock('./supabase', () => {
  /** Cadena de consulta: cada método se anota y sigue encadenando. */
  function chain() {
    const self: any = {
      select: (columns: string) => {
        h.selects.push(columns);
        return self;
      },
      order: (col: string, options: { ascending: boolean }) => {
        h.orders.push({ col, ascending: options.ascending });
        return self;
      },
      limit: (rows: number) => {
        h.limits.push(rows);
        return self;
      },
      // Sin `maybeSingle`: las dos consultas del panel se esperan tal cual.
      then: (resolve: any, reject: any) => Promise.resolve(h.result).then(resolve, reject),
    };
    return self;
  }

  return {
    supabase: {
      from: (table: string) => {
        h.fromCalls.push(table);
        return chain();
      },
    },
  };
});

import {
  fetchInsightEvents,
  fetchInsightMarks,
  INSIGHT_ROW_LIMIT,
} from './insights-data';

beforeEach(() => {
  h.fromCalls.length = 0;
  h.selects.length = 0;
  h.orders.length = 0;
  h.limits.length = 0;
  h.result = { data: null, error: null };
  vi.restoreAllMocks();
});

describe('fetchInsightMarks', () => {
  it('pide solo las tres columnas que el modelo consume, por instante y con tope', async () => {
    h.result = { data: [], error: null };

    await fetchInsightMarks();

    expect(h.fromCalls).toEqual(['pr_practice']);
    expect(h.selects).toEqual(['day,practiced_at,repertoire_id']);
    expect(h.orders).toEqual([{ col: 'practiced_at', ascending: true }]);
    expect(h.limits).toEqual([INSIGHT_ROW_LIMIT]);
  });

  it('mapea la fila a la marca, sin inventar el día ni el instante', async () => {
    h.result = {
      data: [
        { day: '2026-11-13', practiced_at: '2026-11-13T21:30:00+00:00', repertoire_id: 'tune-a' },
        // Sin día: no es una marca, es una fila rota.
        { day: null, practiced_at: '2026-11-13T21:30:00+00:00', repertoire_id: 'tune-b' },
        // Sin instante no se pueden medir huecos de horas.
        { day: '2026-11-13', practiced_at: null, repertoire_id: 'tune-c' },
        // Sin tune no hay a quién atribuirla.
        { day: '2026-11-13', practiced_at: '2026-11-13T21:30:00+00:00', repertoire_id: null },
      ],
      error: null,
    };

    const marks = await fetchInsightMarks();

    expect(marks).toEqual([
      { repertoireId: 'tune-a', day: '2026-11-13', practicedAt: '2026-11-13T21:30:00+00:00' },
    ]);
  });

  it('sin datos devuelve una lista vacía', async () => {
    h.result = { data: null, error: null };
    expect(await fetchInsightMarks()).toEqual([]);
  });

  it('avisa cuando se alcanza el tope en vez de paginar en silencio', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.result = {
      data: Array.from({ length: INSIGHT_ROW_LIMIT }, (_, index) => ({
        day: '2026-11-13',
        practiced_at: '2026-11-13T21:30:00+00:00',
        repertoire_id: `tune-${index}`,
      })),
      error: null,
    };

    const marks = await fetchInsightMarks();

    // Se devuelve lo cargado —no se pagina— y el corte se dice.
    expect(marks).toHaveLength(INSIGHT_ROW_LIMIT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/pr_practice.*cap.*truncated/i);
  });

  it('no avisa si la carga cabe', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.result = {
      data: [{ day: '2026-11-13', practiced_at: '2026-11-13T21:30:00+00:00', repertoire_id: 'a' }],
      error: null,
    };

    await fetchInsightMarks();

    expect(warn).not.toHaveBeenCalled();
  });

  it('falla en voz alta si la consulta no vuelve', async () => {
    h.result = { data: null, error: { message: 'permission denied for table pr_practice' } };

    await expect(fetchInsightMarks()).rejects.toThrow(
      /Could not load the practice marks: permission denied/,
    );
  });
});

describe('fetchInsightEvents', () => {
  it('pide las seis columnas del evento, del más antiguo al más reciente y con tope', async () => {
    h.result = { data: [], error: null };

    await fetchInsightEvents();

    expect(h.fromCalls).toEqual(['pr_ladder_event']);
    expect(h.selects).toEqual(['repertoire_id,kind,from_value,to_value,at,source']);
    expect(h.orders).toEqual([{ col: 'at', ascending: true }]);
    expect(h.limits).toEqual([INSIGHT_ROW_LIMIT]);
  });

  it('pasa los nombres a camelCase y deja `fromValue` a null cuando no había estado', async () => {
    h.result = {
      data: [
        {
          repertoire_id: 'tune-a',
          kind: 'status',
          from_value: null,
          to_value: 'playing_along',
          at: '2026-10-30T20:22:47+00:00',
          source: 'backfill',
        },
        {
          repertoire_id: 'tune-a',
          kind: 'status',
          from_value: 'playing_along',
          to_value: 'shaky',
          at: '2026-11-05T09:00:00+00:00',
          source: 'ui',
        },
      ],
      error: null,
    };

    const events = await fetchInsightEvents();

    expect(events).toEqual([
      {
        repertoireId: 'tune-a',
        kind: 'status',
        fromValue: null,
        toValue: 'playing_along',
        at: '2026-10-30T20:22:47+00:00',
        source: 'backfill',
      },
      {
        repertoireId: 'tune-a',
        kind: 'status',
        fromValue: 'playing_along',
        toValue: 'shaky',
        at: '2026-11-05T09:00:00+00:00',
        source: 'ui',
      },
    ]);
  });

  it('descarta lo que no se puede situar en el tiempo y los `kind` que no conoce', async () => {
    h.result = {
      data: [
        // Sin instante: no hay fecha en la que contarlo.
        { repertoire_id: 'a', kind: 'status', from_value: null, to_value: 'shaky', at: null, source: 'backfill' },
        // Sin valor final no hay estado nuevo.
        { repertoire_id: 'a', kind: 'status', from_value: 'shaky', to_value: null, at: '2026-11-05T09:00:00+00:00', source: 'backfill' },
        // Un tipo de evento desconocido no se cuela como cambio de peldaño.
        { repertoire_id: 'a', kind: 'rename', from_value: null, to_value: 'shaky', at: '2026-11-05T09:00:00+00:00', source: 'backfill' },
        { repertoire_id: 'a', kind: 'shelved', from_value: null, to_value: 'true', at: '2026-11-06T09:00:00+00:00', source: 'ui' },
      ],
      error: null,
    };

    const events = await fetchInsightEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'shelved', source: 'ui' });
  });

  it('sin datos devuelve una lista vacía', async () => {
    expect(await fetchInsightEvents()).toEqual([]);
  });

  it('avisa cuando se alcanza el tope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.result = {
      data: Array.from({ length: INSIGHT_ROW_LIMIT }, (_, index) => ({
        repertoire_id: `tune-${index}`,
        kind: 'status',
        from_value: null,
        to_value: 'shaky',
        at: '2026-11-05T09:00:00+00:00',
        source: 'backfill',
      })),
      error: null,
    };

    const events = await fetchInsightEvents();

    expect(events).toHaveLength(INSIGHT_ROW_LIMIT);
    expect(warn.mock.calls[0][0]).toMatch(/pr_ladder_event.*cap.*truncated/i);
  });

  it('falla en voz alta si la consulta no vuelve', async () => {
    h.result = { data: null, error: { message: 'relation does not exist' } };

    await expect(fetchInsightEvents()).rejects.toThrow(
      /Could not load the ladder events: relation does not exist/,
    );
  });
});
