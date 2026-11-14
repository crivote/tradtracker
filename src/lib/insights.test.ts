/**
 * Modelo del panel de estado (#22): histograma de vencimiento, delta semanal,
 * composición por semana y revisitas.
 *
 * Todo se prueba con el instante **inyectado** y con días locales construidos
 * con `todayKeyFor`, nunca con `new Date('YYYY-MM-DD')`: el runner puede estar en
 * cualquier huso y una prueba que dependa del TZ no prueba el modelo, prueba la
 * máquina.
 *
 * Las fronteras se prueban de una en una (3/4, 7/8, 14/15, 30/31, 60/61): son el
 * sitio donde un `>=` mal puesto deja de verse.
 */
import { describe, expect, it } from 'vitest';
import {
  compositionByWeek,
  overdueDelta,
  overdueHistogram,
  revisits,
  TARGET_DAYS_BY_BAND,
  type InsightEvent,
  type InsightMark,
} from './insights';
import type { LadderStatus, RepertoireRow, TuneStatus } from './repertoire-model';
import { todayKeyFor } from './practice-storage';

/** Instante local del día indicado. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/** Clave `YYYY-MM-DD` del día local de `nowMs`, desplazada `minusDays` días. */
function dayKey(nowMs: number, minusDays = 0): string {
  const date = new Date(nowMs);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - minusDays);
  return todayKeyFor(date.getTime());
}

/** Una fila de repertorio completa, con lo de este panel encima. */
function row(overrides: Partial<RepertoireRow> & { id: string }): RepertoireRow {
  return {
    status: 'playing_along',
    shelved: false,
    favorite: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    customAbc: null,
    notes: null,
    added_at: '2020-01-01T00:00:00+00:00',
    last_practiced_day: null,
    status_changed_at: null,
    tune: {
      id: 'tune',
      origin: 'thesession',
      origin_ref: null,
      name: 'Tune',
      rhythm: 'reel',
      meter: '4/4',
      key: 'G',
      abc: null,
      composer: null,
    },
    image: null,
    practice_count: null,
    avg_quality: null,
    days_since_last_practice: null,
    ...overrides,
  };
}

/** Una fila en rotación con un último ensayo a `days` días de `nowMs`. */
function practicedRow(id: string, status: TuneStatus, nowMs: number, days: number): RepertoireRow {
  return row({ id, status, last_practiced_day: dayKey(nowMs, days) });
}

function mark(repertoireId: string, day: string, practicedAt: string): InsightMark {
  return { repertoireId, day, practicedAt };
}

function statusEvent(
  repertoireId: string,
  toValue: string,
  atIso: string,
  fromValue: string | null = null,
  source = 'backfill',
): InsightEvent {
  return { repertoireId, kind: 'status', fromValue, toValue, at: atIso, source };
}

/** Los recuentos del histograma por clave de tramo, para comparar de una vez. */
function countsByKey(buckets: ReadonlyArray<{ key: string; count: number }>): Record<string, number> {
  return Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.count]));
}

const NOW = at(2026, 11, 14); // sábado 14 de noviembre de 2026, mediodía local

describe('TARGET_DAYS_BY_BAND', () => {
  it('fija el ritmo de repaso de cada peldaño', () => {
    expect(TARGET_DAYS_BY_BAND).toEqual({
      learning: 2,
      shaky: 4,
      playing_along: 7,
      solo_ready: 14,
      mastered: 30,
    });
  });
});

describe('overdueHistogram', () => {
  it('reparte los seis tramos con sus fronteras exactas (3/4, 7/8, 14/15, 30/31, 60/61)', () => {
    const rows = [3, 4, 7, 8, 14, 15, 30, 31, 60, 61].map((days, index) =>
      practicedRow(`t${index}`, 'mastered', NOW, days),
    );

    const histogram = overdueHistogram(rows, NOW);

    expect(countsByKey(histogram.buckets)).toEqual({
      '0-3': 1,
      '4-7': 2,
      '8-14': 2,
      '15-30': 2,
      '31-60': 2,
      '60+': 1,
    });
    expect(histogram.buckets.map((bucket) => bucket.label)).toEqual([
      '0–3',
      '4–7',
      '8–14',
      '15–30',
      '31–60',
      '60+',
    ]);
    // Diez filas con día, todas en rotación: el universo son diez.
    expect(histogram.universe).toBe(10);
    expect(histogram.sinRegistro).toBe(0);
    expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(10);
  });

  it('cuenta el día de hoy en «0–3» y no lo saca del universo', () => {
    const histogram = overdueHistogram([practicedRow('a', 'mastered', NOW, 0)], NOW);
    expect(countsByKey(histogram.buckets)['0-3']).toBe(1);
    expect(histogram.overdue).toBe(0);
  });

  it('deja `sinRegistro` aparte: no es «60+» ni entra en los tramos', () => {
    const rows = [
      row({ id: 'nunca' }),
      row({ id: 'ilegible', last_practiced_day: 'ayer' }),
      practicedRow('vieja', 'mastered', NOW, 400),
    ];

    const histogram = overdueHistogram(rows, NOW);

    expect(histogram.universe).toBe(3);
    // La columna a null y el texto que no es un día son lo mismo: no hay dato.
    expect(histogram.sinRegistro).toBe(2);
    expect(countsByKey(histogram.buckets)).toEqual({
      '0-3': 0,
      '4-7': 0,
      '8-14': 0,
      '15-30': 0,
      '31-60': 0,
      '60+': 1,
    });
    // Los tramos más `sinRegistro` son el universo entero, sin repetir a nadie.
    expect(
      histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0) + histogram.sinRegistro,
    ).toBe(histogram.universe);
  });

  it('no mete en el universo el backlog ni las aparcadas', () => {
    const rows = [
      practicedRow('rotacion', 'shaky', NOW, 1),
      row({ id: 'backlog', status: 'to_learn', last_practiced_day: dayKey(NOW, 30) }),
      row({ id: 'aparcada', status: 'mastered', shelved: true, last_practiced_day: dayKey(NOW, 30) }),
    ];

    const histogram = overdueHistogram(rows, NOW);

    expect(histogram.universe).toBe(1);
    expect(histogram.sinRegistro).toBe(0);
    expect(countsByKey(histogram.buckets)['0-3']).toBe(1);
  });

  it('marca vencida por el umbral de cada peldaño, justo en el día del umbral', () => {
    // Una fila por peldaño en su umbral exacto (no vencida) y otra un día más
    // (vencida): el corte es «días > objetivo».
    const bands: LadderStatus[] = ['learning', 'shaky', 'playing_along', 'solo_ready', 'mastered'];
    const rows = bands.flatMap((status) => [
      practicedRow(`${status}-justo`, status, NOW, TARGET_DAYS_BY_BAND[status]),
      practicedRow(`${status}-pasada`, status, NOW, TARGET_DAYS_BY_BAND[status] + 1),
    ]);

    const histogram = overdueHistogram(rows, NOW);

    expect(histogram.overdue).toBe(5);
    expect(histogram.overduePct).toBe(50);
    expect(histogram.byBand.map((band) => band.band)).toEqual(bands);
    for (const band of histogram.byBand) {
      expect(band.practiced).toBe(2);
      expect(band.overdue).toBe(1);
      expect(band.pct).toBe(50);
    }
  });

  it('calcula los porcentajes sobre el universo, y el de vencidas sobre las que tienen día', () => {
    const rows = [
      practicedRow('vieja', 'learning', NOW, 5), // 5 > 2: vencida
      practicedRow('fresca', 'learning', NOW, 1),
      row({ id: 'sin-registro' }),
      row({ id: 'sin-registro-2' }),
    ];

    const histogram = overdueHistogram(rows, NOW);

    expect(histogram.universe).toBe(4);
    expect(histogram.sinRegistro).toBe(2);
    // «4–7» tiene una de cuatro filas del universo: 25 %.
    expect(histogram.buckets.find((bucket) => bucket.key === '4-7')?.pct).toBe(25);
    // Vencidas: una de las dos que tienen día (no del universo entero).
    expect(histogram.overdue).toBe(1);
    expect(histogram.overduePct).toBe(50);
    expect(histogram.byBand.find((band) => band.band === 'learning')).toMatchObject({
      practiced: 2,
      overdue: 1,
      pct: 50,
    });
  });

  it('sin filas devuelve el histograma vacío, con las cinco bandas a cero', () => {
    const histogram = overdueHistogram([], NOW);

    expect(histogram.universe).toBe(0);
    expect(histogram.sinRegistro).toBe(0);
    expect(histogram.overdue).toBe(0);
    expect(histogram.overduePct).toBe(0);
    expect(histogram.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(histogram.buckets.map((bucket) => bucket.pct)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(histogram.byBand).toHaveLength(5);
    expect(histogram.byBand.every((band) => band.practiced === 0 && band.overdue === 0)).toBe(true);
  });

  it('una marca de las 23:30 locales cuenta en su día, no en el siguiente', () => {
    // El día lo compone el cliente con `todayKeyFor` (local). A las 00:30 del 14,
    // el ensayo de las 23:30 del 13 sigue siendo «ayer»: un día, no dos.
    const lateMarkAt = at(2026, 11, 13, 23, 30);
    const day = todayKeyFor(lateMarkAt);
    expect(day).toBe('2026-11-13');

    const histogram = overdueHistogram(
      [row({ id: 'tarde', status: 'playing_along', last_practiced_day: day })],
      at(2026, 11, 14, 0, 30),
    );

    expect(countsByKey(histogram.buckets)['0-3']).toBe(1);
    expect(histogram.overdue).toBe(0);
  });
});

describe('overdueDelta', () => {
  /** Tres filas en rotación con foto de hoy y foto del domingo anterior. */
  function scenario() {
    const rows = [
      practicedRow('a', 'playing_along', NOW, 4),
      practicedRow('b', 'playing_along', NOW, 15),
      practicedRow('c', 'shaky', NOW, 1),
      row({ id: 'backlog', status: 'to_learn', last_practiced_day: dayKey(NOW, 40) }),
      row({ id: 'aparcada', status: 'mastered', shelved: true, last_practiced_day: dayKey(NOW, 40) }),
    ];
    const events = [
      statusEvent('a', 'playing_along', '2026-11-01T10:00:00+00:00'),
      statusEvent('b', 'playing_along', '2026-11-01T10:05:00+00:00'),
      statusEvent('c', 'shaky', '2026-11-01T10:10:00+00:00'),
    ];
    const marks = [
      // a: 6 días al domingo 8 → dentro de sus 7, no vencida entonces.
      mark('a', '2026-11-02', '2026-11-02T10:00:00+00:00'),
      // b: 14 días al domingo → vencida entonces y ahora.
      mark('b', '2026-10-25', '2026-10-25T10:00:00+00:00'),
      // c: 19 días al domingo → vencida entonces; hoy lleva 1 día.
      mark('c', '2026-10-20', '2026-10-20T10:00:00+00:00'),
    ];
    return { rows, events, marks };
  }

  it('compara hoy con el cierre del domingo pasado', () => {
    const { rows, events, marks } = scenario();

    const delta = overdueDelta(rows, marks, events, NOW);

    // Hoy: una vencida de tres con día (b).
    expect(delta.currentPct).toBe(33.3);
    // Domingo 8: vencidas b y c de tres → 66,7 %.
    expect(delta.previousPct).toBe(66.7);
    expect(delta.deltaPp).toBe(-33.4);
    expect(delta.enoughHistory).toBe(true);

    const playing = delta.byBand.find((band) => band.band === 'playing_along');
    expect(playing).toMatchObject({ currentPct: 50, previousPct: 50, deltaPp: 0 });
    const shaky = delta.byBand.find((band) => band.band === 'shaky');
    expect(shaky).toMatchObject({ currentPct: 0, previousPct: 100, deltaPp: -100 });
    // Un peldaño sin filas con día no inventa un porcentaje.
    expect(delta.byBand.find((band) => band.band === 'mastered')).toMatchObject({
      currentPct: 0,
      previousPct: 0,
      deltaPp: 0,
    });
  });

  it('deja fuera el backlog y las aparcadas en las dos fotos', () => {
    const { rows, events, marks } = scenario();
    const delta = overdueDelta(rows, marks, events, NOW);
    // El backlog y la aparcada llevan 40 días sin tocarse y aun así no cuentan:
    // 3 filas con día hoy, no 5.
    expect(delta.currentPct).toBe(33.3);
    expect(delta.byBand.find((band) => band.band === 'mastered')).toMatchObject({
      currentPct: 0,
      previousPct: 0,
    });
  });

  it('no usa el peldaño de hoy para la foto de la semana pasada', () => {
    const rows = [practicedRow('a', 'solo_ready', NOW, 8)];
    const events = [statusEvent('a', 'learning', '2026-11-01T10:00:00+00:00')];
    const marks = [mark('a', '2026-11-04', '2026-11-04T10:00:00+00:00')];

    const delta = overdueDelta(rows, marks, events, NOW);

    // Hoy, solo_ready y 8 días: dentro de 14 → no vencida.
    expect(delta.currentPct).toBe(0);
    // El domingo 8 estaba en `learning` (objetivo 2) y llevaba 4 días: vencida.
    expect(delta.previousPct).toBe(100);
    expect(delta.deltaPp).toBe(-100);
  });

  it('mide las dos fotos sobre el mismo censo: la fila sin estado el domingo no entra en ninguna', () => {
    const rows = [practicedRow('a', 'playing_along', NOW, 4), practicedRow('b', 'playing_along', NOW, 30)];
    const events = [statusEvent('b', 'playing_along', '2026-11-10T10:00:00+00:00')];
    const marks = [
      mark('a', '2026-11-02', '2026-11-02T10:00:00+00:00'),
      mark('b', '2026-11-01', '2026-11-01T10:00:00+00:00'),
    ];

    const delta = overdueDelta(rows, marks, events, NOW);

    // `b` no tenía estado el domingo 8: queda fuera de la foto vieja y también de
    // la de hoy, que se mide sobre el mismo censo. Si hoy se midiera sobre las
    // dos, `b` —30 días, vencida— movería el porcentaje y el delta confundiría
    // «el repertorio ha crecido» con «estas tunes han envejecido».
    expect(delta.previousPct).toBe(0);
    expect(delta.currentPct).toBe(0);
    expect(delta.deltaPp).toBe(0);
  });

  it('sin ninguna marca anterior a ese domingo no hay comparación (`enoughHistory: false`)', () => {
    const rows = [practicedRow('a', 'playing_along', NOW, 3)];
    const events = [statusEvent('a', 'playing_along', '2026-11-01T10:00:00+00:00')];
    // La única marca es de esta semana.
    const marks = [mark('a', '2026-11-12', '2026-11-12T10:00:00+00:00')];

    const delta = overdueDelta(rows, marks, events, NOW);

    expect(delta.enoughHistory).toBe(false);
    // No hay denominador del que sacar la foto vieja: 0, y la UI no lo lee.
    expect(delta.previousPct).toBe(0);
    expect(delta.currentPct).toBe(0);
    expect(delta.deltaPp).toBe(0);
  });

  it('sin filas devuelve la estructura vacía, con `enoughHistory: false`', () => {
    const delta = overdueDelta([], [], [], NOW);

    expect(delta).toMatchObject({
      currentPct: 0,
      previousPct: 0,
      deltaPp: 0,
      enoughHistory: false,
    });
    expect(delta.byBand).toHaveLength(5);
    expect(delta.byBand.every((band) => band.deltaPp === 0)).toBe(true);
  });
});

describe('compositionByWeek', () => {
  it('compone cada semana con el último evento `status` hasta su domingo', () => {
    const rows = [
      row({ id: 'a', status: 'solo_ready' }),
      row({ id: 'b', status: 'mastered' }),
      row({ id: 'd', status: 'solo_ready', shelved: true }),
      row({ id: 'backlog', status: 'to_learn' }),
    ];
    const events = [
      statusEvent('a', 'shaky', '2026-10-30T10:00:00+00:00'),
      statusEvent('b', 'mastered', '2026-11-10T10:00:00+00:00'),
    ];

    const weeks = compositionByWeek(rows, events, 3, NOW);

    expect(weeks.map((week) => week.key)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    // El universo incluye la aparcada (conserva su peldaño) y excluye el backlog.
    expect(weeks.map((week) => week.total)).toEqual([3, 3, 3]);
    // Antes del primer evento, todo «sin estado registrado»: no se inventa.
    expect(weeks[0].byBand).toEqual({
      learning: 0,
      shaky: 1,
      playing_along: 0,
      solo_ready: 0,
      mastered: 0,
    });
    expect(weeks[0].sinEstado).toBe(2);
    expect(weeks[1]).toMatchObject({ sinEstado: 2 });
    // La última: `a` sigue shaky en el registro (su fila ya dice solo_ready, pero
    // no hay evento que lo respalde) y `b` entra al cargarse el 10.
    expect(weeks[2]).toMatchObject({
      sinEstado: 1,
      byBand: { learning: 0, shaky: 1, playing_along: 0, solo_ready: 0, mastered: 1 },
    });
    // Cada semana reparte el universo entero entre peldaños y `sinEstado`.
    for (const week of weeks) {
      const counted =
        week.sinEstado + Object.values(week.byBand).reduce((sum, value) => sum + value, 0);
      expect(counted).toBe(week.total);
    }
  });

  it('arranca con todas las semanas sin estado cuando no hay eventos', () => {
    const weeks = compositionByWeek([row({ id: 'a', status: 'shaky' })], [], 2, NOW);

    expect(weeks).toHaveLength(2);
    expect(weeks.every((week) => week.sinEstado === 1)).toBe(true);
    expect(weeks.every((week) => Object.values(week.byBand).every((value) => value === 0))).toBe(
      true,
    );
  });

  it('la semana en curso entra como última y se cierra con lo que ya pasó', () => {
    const events = [statusEvent('a', 'learning', '2026-11-13T10:00:00+00:00')];
    const weeks = compositionByWeek([row({ id: 'a', status: 'learning' })], events, 1, NOW);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].key).toBe('2026-11-09');
    expect(weeks[0].byBand.learning).toBe(1);
    expect(weeks[0].sinEstado).toBe(0);
  });

  it('con `weeks` a cero no hay serie', () => {
    expect(compositionByWeek([row({ id: 'a' })], [], 0, NOW)).toEqual([]);
    expect(compositionByWeek([row({ id: 'a' })], [], -3, NOW)).toEqual([]);
  });
});

describe('revisits', () => {
  it('mide el hueco en horas entre pasadas consecutivas y saca la mediana', () => {
    const rows = [
      row({ id: 'p', status: 'playing_along' }), // objetivo 7 días = 168 h
      row({ id: 'q', status: 'learning' }), // objetivo 2 días = 48 h
      row({ id: 'backlog', status: 'to_learn' }),
    ];
    const marks = [
      // p: huecos de 12 h (noche de por medio), 96 h y 120 h.
      mark('p', '2026-11-01', '2026-11-01T20:00:00Z'),
      mark('p', '2026-11-02', '2026-11-02T08:00:00Z'),
      mark('p', '2026-11-06', '2026-11-06T08:00:00Z'),
      mark('p', '2026-11-11', '2026-11-11T08:00:00Z'),
      // q: huecos de 72 h (por encima de 48) y 24 h (justo la mitad).
      mark('q', '2026-11-01', '2026-11-01T08:00:00Z'),
      mark('q', '2026-11-04', '2026-11-04T08:00:00Z'),
      mark('q', '2026-11-05', '2026-11-05T08:00:00Z'),
      // El backlog no tiene objetivo: sus huecos no entran en la cuenta.
      mark('backlog', '2026-11-01', '2026-11-01T08:00:00Z'),
      mark('backlog', '2026-11-02', '2026-11-02T08:00:00Z'),
    ];

    const summary = revisits(marks, rows);

    expect(summary.pairs).toBe(5);
    // Huecos [12, 96, 120, 72, 24] → mediana 72.
    expect(summary.medianHours).toBe(72);
    // Por ratio: 12 h sobre 168 → 0,07 (demasiado pronto); 96 y 120 sobre 168 y
    // 24 sobre 48 caen en banda; 72 sobre 48 → 1,5 (tarde). Los tres suman pairs.
    expect(summary.tooSoon).toBe(1);
    expect(summary.inBand).toBe(3);
    expect(summary.late).toBe(1);
    expect(countsByKey(summary.buckets)).toEqual({
      'under-0.5': 1, // 12 h sobre 168 → 0,07
      '0.5-1': 3, // 96 h (0,57), 120 h (0,71) y 24 h sobre 48 (0,5)
      '1-2': 1, // 72 h sobre 48 → 1,5
      '2+': 0,
    });
    expect(summary.buckets.map((bucket) => bucket.pct)).toEqual([20, 60, 20, 0]);
  });

  it('sin dos pasadas de la misma tune no hay pares ni mediana', () => {
    const rows = [row({ id: 'a', status: 'shaky' })];
    const marks = [mark('a', '2026-11-01', '2026-11-01T08:00:00Z')];

    const summary = revisits(marks, rows);

    expect(summary.pairs).toBe(0);
    // `null`, no 0: no hay una mediana de cero horas.
    expect(summary.medianHours).toBeNull();
    expect(summary.tooSoon).toBe(0);
    expect(summary.inBand).toBe(0);
    expect(summary.late).toBe(0);
    expect(summary.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0]);
    expect(summary.buckets.map((bucket) => bucket.pct)).toEqual([0, 0, 0, 0]);
  });

  it('sin marcas devuelve la estructura vacía', () => {
    expect(revisits([], [])).toMatchObject({ pairs: 0, medianHours: null, tooSoon: 0, inBand: 0, late: 0 });
  });

  it('no depende del orden en que lleguen las marcas', () => {
    const rows = [row({ id: 'a', status: 'learning' })];
    const marks = [
      mark('a', '2026-11-03', '2026-11-03T08:00:00Z'),
      mark('a', '2026-11-01', '2026-11-01T08:00:00Z'),
      mark('a', '2026-11-02', '2026-11-02T08:00:00Z'),
    ];

    expect(revisits(marks, rows).medianHours).toBe(24);
  });
});
