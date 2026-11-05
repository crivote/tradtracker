import { describe, it, expect, beforeEach } from 'vitest';
import {
  INSTRUMENTS,
  DEFAULT_PREFS,
  DAILY_TARGET_MIN,
  DAILY_TARGET_MAX,
  LEARNING_SLOTS_MIN,
  LEARNING_SLOTS_MAX,
  RECENT_LIMIT,
  readPrefs,
  writePrefs,
  readRecentLists,
  recordRecentList,
  previousIds,
  readPlan,
  writePlan,
  clearPlan,
  todayKeyFor,
  startOfLocalDay,
  type KeyValueStore,
  type RecentList,
} from './practice-storage';

const PREFS_KEY = 'tt-practice-prefs';
const RECENT_KEY = 'tt-practice-recent';
const PLAN_KEY = 'tt-practice-plan';
/** Clave de la lista congelada por fecha: solo existe para migrarla. */
const LEGACY_KEY = 'tt-practice-today';

/** Doble en memoria: no hace falta jsdom. */
function makeStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

let store: ReturnType<typeof makeStore>;

beforeEach(() => {
  store = makeStore();
});

describe('constantes del contrato', () => {
  it('INSTRUMENTS son los cuatro, en orden', () => {
    expect(INSTRUMENTS).toEqual(['fiddle', 'whistle', 'accordion', 'banjo']);
  });

  it('DEFAULT_PREFS es fiddle/8/6 y los rangos son 1..20', () => {
    expect(DEFAULT_PREFS).toEqual({ instrument: 'fiddle', dailyTarget: 8, learningSlots: 6 });
    expect(DAILY_TARGET_MIN).toBe(1);
    expect(DAILY_TARGET_MAX).toBe(20);
    expect(LEARNING_SLOTS_MIN).toBe(1);
    expect(LEARNING_SLOTS_MAX).toBe(20);
    expect(RECENT_LIMIT).toBe(3);
  });
});

describe('readPrefs / writePrefs', () => {
  it('sin nada guardado devuelve los defaults completos', () => {
    expect(readPrefs(store)).toEqual({ instrument: 'fiddle', dailyTarget: 8, learningSlots: 6 });
  });

  it('hace ida y vuelta de un instrumento y objetivo válidos', () => {
    writePrefs(store, { instrument: 'banjo', dailyTarget: 12, learningSlots: 4 });
    expect(readPrefs(store)).toEqual({ instrument: 'banjo', dailyTarget: 12, learningSlots: 4 });
  });

  it('un instrumento desconocido cae a fiddle pero conserva el objetivo', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'bouzouki', dailyTarget: 15 }));
    // Una clave escrita antes de #52 no trae el tope: cae al valor por defecto,
    // no a `undefined` (que bloquearía el taller con un `NaN`).
    expect(readPrefs(store)).toEqual({ instrument: 'fiddle', dailyTarget: 15, learningSlots: 6 });
  });

  it('el tope del taller se acota y una basura cae al valor por defecto (#52)', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ learningSlots: 99 }));
    expect(readPrefs(store).learningSlots).toBe(LEARNING_SLOTS_MAX);
    store.setItem(PREFS_KEY, JSON.stringify({ learningSlots: 0 }));
    expect(readPrefs(store).learningSlots).toBe(LEARNING_SLOTS_MIN);
    store.setItem(PREFS_KEY, JSON.stringify({ learningSlots: '8' }));
    expect(readPrefs(store).learningSlots).toBe(6);
  });

  it('devuelve las tres claves aunque solo haya una guardada', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ dailyTarget: 5 }));
    expect(readPrefs(store)).toEqual({ instrument: 'fiddle', dailyTarget: 5, learningSlots: 6 });
  });

  it('acota el objetivo fuera de rango en vez de descartarlo', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'whistle', dailyTarget: 99 }));
    expect(readPrefs(store).dailyTarget).toBe(DAILY_TARGET_MAX);
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'whistle', dailyTarget: -4 }));
    expect(readPrefs(store).dailyTarget).toBe(DAILY_TARGET_MIN);
  });

  it('redondea un objetivo decimal', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'accordion', dailyTarget: 6.6 }));
    expect(readPrefs(store).dailyTarget).toBe(7);
  });

  it('un objetivo como cadena no es válido y cae al valor por defecto', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'fiddle', dailyTarget: '12' }));
    expect(readPrefs(store).dailyTarget).toBe(DEFAULT_PREFS.dailyTarget);
  });

  it('un objetivo no finito cae al valor por defecto', () => {
    store.setItem(PREFS_KEY, JSON.stringify({ instrument: 'fiddle', dailyTarget: Number.NaN }));
    expect(readPrefs(store).dailyTarget).toBe(DEFAULT_PREFS.dailyTarget);
  });

  it('JSON inválido, null, array, objeto y número caen a defaults sin lanzar', () => {
    for (const raw of ['{no es json', 'null', '[]', '42', '"texto"', 'true']) {
      store.setItem(PREFS_KEY, raw);
      expect(readPrefs(store)).toEqual({ instrument: 'fiddle', dailyTarget: 8, learningSlots: 6 });
    }
  });

  it('un almacenamiento que lanza al leer no rompe la vista', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readPrefs(throwing)).toEqual(DEFAULT_PREFS);
    expect(readRecentLists(throwing)).toEqual([]);
    expect(readPlan(throwing, new Date(2026, 9, 31, 12, 0).getTime())).toBeNull();
  });
});

describe('readRecentLists', () => {
  it('sin nada guardado devuelve una lista vacía', () => {
    expect(readRecentLists(store)).toEqual([]);
  });

  it('ordena por fecha descendente', () => {
    store.setItem(
      RECENT_KEY,
      JSON.stringify([
        { date: '2026-10-28', ids: ['a'] },
        { date: '2026-10-30', ids: ['b'] },
        { date: '2026-10-29', ids: ['c'] },
      ]),
    );
    expect(readRecentLists(store).map(list => list.date)).toEqual([
      '2026-10-30',
      '2026-10-29',
      '2026-10-28',
    ]);
  });

  it('recorta a RECENT_LIMIT al leer', () => {
    store.setItem(
      RECENT_KEY,
      JSON.stringify([
        { date: '2026-10-26', ids: ['a'] },
        { date: '2026-10-27', ids: ['b'] },
        { date: '2026-10-28', ids: ['c'] },
        { date: '2026-10-29', ids: ['d'] },
        { date: '2026-10-30', ids: ['e'] },
      ]),
    );
    const lists = readRecentLists(store);
    expect(lists).toHaveLength(RECENT_LIMIT);
    expect(lists[0].date).toBe('2026-10-30');
  });

  it('descarta entradas con forma inválida y conserva las buenas', () => {
    store.setItem(
      RECENT_KEY,
      JSON.stringify([
        { date: '2026-10-30', ids: ['ok'] },
        { date: 'ayer', ids: ['x'] },
        { ids: ['sin-fecha'] },
        null,
        42,
        { date: '2026-10-29', ids: 'no-es-array' },
        { date: '2026-10-28' },
      ]),
    );
    expect(readRecentLists(store)).toEqual([{ date: '2026-10-30', ids: ['ok'] }]);
  });

  it('JSON corrupto o que no es array devuelve vacío sin lanzar', () => {
    for (const raw of ['', '{{', 'null', '{}', '7']) {
      store.setItem(RECENT_KEY, raw);
      expect(readRecentLists(store)).toEqual([]);
    }
  });
});

describe('recordRecentList', () => {
  it('añade la lista delante y la devuelve guardada', () => {
    const saved = recordRecentList(store, { date: '2026-10-31', ids: ['a', 'b'] });
    expect(saved).toEqual([{ date: '2026-10-31', ids: ['a', 'b'] }]);
    expect(readRecentLists(store)).toEqual(saved);
  });

  it('no duplica por fecha: la segunda llamada sustituye', () => {
    recordRecentList(store, { date: '2026-10-31', ids: ['a'] });
    const saved = recordRecentList(store, { date: '2026-10-31', ids: ['b', 'c'] });
    expect(saved).toEqual([{ date: '2026-10-31', ids: ['b', 'c'] }]);
    expect(readRecentLists(store)).toHaveLength(1);
  });

  it('mantiene el orden descendente aunque se grabe una fecha vieja', () => {
    recordRecentList(store, { date: '2026-10-30', ids: ['hoy-1'] });
    const saved = recordRecentList(store, { date: '2026-10-28', ids: ['vieja'] });
    expect(saved.map(list => list.date)).toEqual(['2026-10-30', '2026-10-28']);
  });

  it('se queda solo con las RECENT_LIMIT más recientes', () => {
    recordRecentList(store, { date: '2026-10-26', ids: ['a'] });
    recordRecentList(store, { date: '2026-10-27', ids: ['b'] });
    recordRecentList(store, { date: '2026-10-28', ids: ['c'] });
    const saved = recordRecentList(store, { date: '2026-10-29', ids: ['d'] });
    expect(saved.map(list => list.date)).toEqual(['2026-10-29', '2026-10-28', '2026-10-27']);
  });

  it('no comparte la referencia de los ids con el llamante', () => {
    const ids = ['a'];
    recordRecentList(store, { date: '2026-10-31', ids });
    ids.push('b');
    expect(readRecentLists(store)[0].ids).toEqual(['a']);
  });
});

describe('previousIds', () => {
  it('sin listas guardadas devuelve un conjunto vacío', () => {
    expect(previousIds(store, '2026-10-31').size).toBe(0);
  });

  it('ignora la lista de hoy: si solo está la de hoy, devuelve vacío', () => {
    recordRecentList(store, { date: '2026-10-31', ids: ['a', 'b'] });
    expect(previousIds(store, '2026-10-31').size).toBe(0);
  });

  it('si la de hoy aún no está guardada, cuenta la más reciente (ayer)', () => {
    recordRecentList(store, { date: '2026-10-29', ids: ['antigua'] });
    recordRecentList(store, { date: '2026-10-30', ids: ['ayer', 'otra'] });
    expect(previousIds(store, '2026-10-31')).toEqual(new Set(['ayer', 'otra']));
  });

  it('con la de hoy guardada, salta a la anterior', () => {
    recordRecentList(store, { date: '2026-10-30', ids: ['ayer'] });
    recordRecentList(store, { date: '2026-10-31', ids: ['hoy'] });
    expect(previousIds(store, '2026-10-31')).toEqual(new Set(['ayer']));
  });
});

describe('readPlan / writePlan / clearPlan', () => {
  const AT_NOON = new Date(2026, 9, 31, 12, 0).getTime();

  it('sin lista guardada devuelve null', () => {
    expect(readPlan(store, AT_NOON)).toBeNull();
  });

  it('guarda y devuelve la lista con su overflow y su sesión', () => {
    writePlan(store, { createdAt: AT_NOON, ids: ['a', 'b'], overflow: 3, sessionId: 'session-1' });
    expect(readPlan(store, AT_NOON)).toEqual({
      createdAt: AT_NOON,
      ids: ['a', 'b'],
      overflow: 3,
      sessionId: 'session-1',
    });
  });

  it('la lista no caduca con la fecha: la de hace días sigue siendo la lista', () => {
    const longAgo = new Date(2026, 8, 1, 9, 0).getTime();
    writePlan(store, { createdAt: longAgo, ids: ['a'], overflow: 0, sessionId: null });

    expect(readPlan(store, AT_NOON)?.ids).toEqual(['a']);
    expect(readPlan(store, AT_NOON)?.createdAt).toBe(longAgo);
  });

  it('la primera marca deja la sesión escrita y se relee al recargar', () => {
    writePlan(store, { createdAt: AT_NOON, ids: ['a'], overflow: 0, sessionId: null });
    const plan = readPlan(store, AT_NOON);
    expect(plan?.sessionId).toBeNull();

    writePlan(store, { ...(plan as NonNullable<typeof plan>), sessionId: 'session-9' });
    expect(readPlan(store, AT_NOON)?.sessionId).toBe('session-9');
  });

  it('clearPlan revoca la lista: la próxima lectura no la encuentra', () => {
    writePlan(store, { createdAt: AT_NOON, ids: ['a'], overflow: 0, sessionId: 'session-1' });
    clearPlan(store);

    expect(readPlan(store, AT_NOON)).toBeNull();
    expect(store.getItem(PLAN_KEY)).toBeNull();
  });

  it('una sesión vacía o de otro tipo se lee como null, no como cadena', () => {
    store.setItem(
      PLAN_KEY,
      JSON.stringify({ createdAt: AT_NOON, ids: ['a'], overflow: 0, sessionId: '' }),
    );
    expect(readPlan(store, AT_NOON)?.sessionId).toBeNull();
  });

  it('un overflow corrupto queda en 0 sin lanzar', () => {
    const corruptos: unknown[] = [undefined, null, -5, '4', Number.NaN, Infinity, {}, [3]];
    for (const overflow of corruptos) {
      store.setItem(PLAN_KEY, JSON.stringify({ createdAt: AT_NOON, ids: ['a'], overflow }));
      expect(readPlan(store, AT_NOON)?.overflow).toBe(0);
    }
  });

  it('un overflow decimal se redondea y nunca queda negativo', () => {
    store.setItem(PLAN_KEY, JSON.stringify({ createdAt: AT_NOON, ids: [], overflow: 2.4 }));
    expect(readPlan(store, AT_NOON)?.overflow).toBe(2);
    store.setItem(PLAN_KEY, JSON.stringify({ createdAt: AT_NOON, ids: [], overflow: -0.6 }));
    expect(readPlan(store, AT_NOON)?.overflow).toBe(0);
  });

  it('sin createdAt válido no hay plan: no se puede fechar ni sembrar', () => {
    const invalidos: unknown[] = [undefined, null, 0, -5, '123', Number.NaN, Infinity, {}];
    for (const createdAt of invalidos) {
      store.setItem(PLAN_KEY, JSON.stringify({ createdAt, ids: ['a'] }));
      expect(readPlan(store, AT_NOON)).toBeNull();
    }
  });

  it('writePlan se niega a guardar un plan sin instante de generación', () => {
    expect(() =>
      writePlan(store, { createdAt: 0, ids: ['a'], overflow: 0, sessionId: null }),
    ).toThrow(/createdAt/);
    expect(store.getItem(PLAN_KEY)).toBeNull();
  });

  it('JSON corrupto, forma inválida o ids que no son array devuelven null', () => {
    for (const raw of ['{roto', 'null', '[]', '3', JSON.stringify({ createdAt: AT_NOON })]) {
      store.setItem(PLAN_KEY, raw);
      expect(readPlan(store, AT_NOON)).toBeNull();
    }
  });

  it('no comparte la referencia de los ids con el llamante', () => {
    const ids = ['a'];
    writePlan(store, { createdAt: AT_NOON, ids, overflow: 0, sessionId: null });
    ids.push('b');
    expect(readPlan(store, AT_NOON)?.ids).toEqual(['a']);
  });
});

describe('migración de la lista congelada por fecha', () => {
  const NOON = new Date(2026, 9, 31, 12, 0).getTime();

  it('adopta la lista vieja de hoy, sin sesión, y borra la clave vieja', () => {
    store.setItem(
      LEGACY_KEY,
      JSON.stringify({ date: '2026-10-31', ids: ['a', 'b'], overflow: 2 }),
    );

    expect(readPlan(store, NOON)).toEqual({
      createdAt: startOfLocalDay(NOON),
      ids: ['a', 'b'],
      overflow: 2,
      sessionId: null,
    });
    // Borrada al adoptarla: si no, «New list» la resucitaría en la lectura siguiente.
    expect(store.getItem(LEGACY_KEY)).toBeNull();
  });

  it('una lista vieja de ayer se descarta, como antes', () => {
    store.setItem(LEGACY_KEY, JSON.stringify({ date: '2026-10-30', ids: ['a'] }));
    expect(readPlan(store, NOON)).toBeNull();
  });

  it('con un plan ya guardado, la clave vieja ni se mira', () => {
    writePlan(store, { createdAt: NOON, ids: ['nueva'], overflow: 0, sessionId: null });
    store.setItem(LEGACY_KEY, JSON.stringify({ date: '2026-10-31', ids: ['vieja'] }));

    expect(readPlan(store, NOON)?.ids).toEqual(['nueva']);
  });

  it('tras revocar la lista, la vieja no vuelve', () => {
    store.setItem(LEGACY_KEY, JSON.stringify({ date: '2026-10-31', ids: ['vieja'] }));
    expect(readPlan(store, NOON)?.ids).toEqual(['vieja']); // se migra

    clearPlan(store); // el usuario pide otra

    expect(readPlan(store, NOON)).toBeNull();
  });
});

describe('todayKeyFor', () => {
  it('usa la fecha local del instante, no la UTC', () => {
    // 23:30 hora local: toISOString().slice(0,10) daría el día siguiente en Madrid.
    expect(todayKeyFor(new Date(2026, 9, 31, 23, 30).getTime())).toBe('2026-10-31');
  });

  it('pasada la medianoche local cambia de día', () => {
    expect(todayKeyFor(new Date(2026, 10, 1, 0, 5).getTime())).toBe('2026-11-01');
  });

  it('rellena mes y día a dos dígitos', () => {
    expect(todayKeyFor(new Date(2026, 0, 5, 9, 0).getTime())).toBe('2026-01-05');
  });

  it('es determinista para el mismo instante', () => {
    const ms = new Date(2026, 9, 31, 12, 0).getTime();
    expect(todayKeyFor(ms)).toBe(todayKeyFor(ms));
    expect(todayKeyFor(ms)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('startOfLocalDay (#36)', () => {
  it('devuelve la medianoche local del día que contiene el instante', () => {
    const noon = new Date(2026, 9, 31, 12, 0).getTime();
    const start = new Date(startOfLocalDay(noon));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(31);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('las 23:30 siguen siendo del mismo día local, no del siguiente', () => {
    const late = new Date(2026, 9, 31, 23, 30).getTime();
    expect(new Date(startOfLocalDay(late)).getDate()).toBe(31);
    // Y la fecha local del inicio coincide con la del instante: es la frontera
    // que compara la vista con `started_at`.
    expect(todayKeyFor(startOfLocalDay(late))).toBe(todayKeyFor(late));
  });

  it('es idempotente y estable dentro del mismo día', () => {
    const early = new Date(2026, 10, 1, 0, 0).getTime();
    const night = new Date(2026, 10, 1, 23, 59, 59, 999).getTime();
    expect(startOfLocalDay(early)).toBe(early);
    expect(startOfLocalDay(night)).toBe(early);
    expect(startOfLocalDay(startOfLocalDay(night))).toBe(early);
  });

  it('cruza el cambio de hora sin contar 86 400 000 ms', () => {
    // 2026-10-25 en Madrid: el día dura 25 h. La frontera sigue siendo la medianoche local.
    const afterChange = new Date(2026, 9, 25, 12, 0).getTime();
    const start = new Date(startOfLocalDay(afterChange));
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(25);
  });
});

describe('integración del ciclo de la lista', () => {
  it('guarda la lista con su sesión y alimenta la penalización con la anterior', () => {
    const createdAt = new Date(2026, 9, 31, 23, 30).getTime();
    const today = todayKeyFor(createdAt);
    const yesterday: RecentList = { date: '2026-10-30', ids: ['jig-1', 'reel-2'] };

    recordRecentList(store, yesterday);
    expect(readPlan(store, createdAt)).toBeNull();
    expect(previousIds(store, today)).toEqual(new Set(['jig-1', 'reel-2']));

    writePlan(store, {
      createdAt,
      ids: ['reel-2', 'hornpipe-3'],
      overflow: 4,
      sessionId: 'session-1',
    });
    recordRecentList(store, { date: today, ids: ['reel-2', 'hornpipe-3'] });

    const plan = readPlan(store, createdAt);
    expect(plan?.ids).toEqual(['reel-2', 'hornpipe-3']);
    expect(plan?.overflow).toBe(4);
    expect(plan?.sessionId).toBe('session-1');
    expect(previousIds(store, today)).toEqual(new Set(['jig-1', 'reel-2']));
    expect(readRecentLists(store).map(list => list.date)).toEqual([today, '2026-10-30']);
  });
});

describe('aislamiento entre claves', () => {
  it('las claves son literales distintas y no se pisan', () => {
    const at = new Date(2026, 9, 31, 12, 0).getTime();
    writePrefs(store, { instrument: 'whistle', dailyTarget: 10, learningSlots: 6 });
    recordRecentList(store, { date: '2026-10-31', ids: ['a'] });
    writePlan(store, { createdAt: at, ids: ['a'], overflow: 0, sessionId: null });

    expect([...store.data.keys()].sort()).toEqual([PREFS_KEY, RECENT_KEY, PLAN_KEY].sort());
    expect(readPrefs(store).dailyTarget).toBe(10);
    expect(readRecentLists(store)).toHaveLength(1);
    expect(readPlan(store, at)?.ids).toEqual(['a']);
  });
});
