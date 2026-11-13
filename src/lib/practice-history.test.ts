/**
 * Modelo del historial (`/history`): agrupación por día local, cifras y serie de
 * la gráfica. Todo es puro y se prueba sin red ni base.
 *
 * Las fechas se construyen con el constructor local (`new Date(año, mes, día,
 * hora)`) y se comparan contra claves locales: la prueba no depende de la zona
 * horaria del runner, que es justo el error que este código evita cometer.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHistoryDays,
  dayKeyOf,
  dayLabel,
  historySeries,
  historyStats,
  practiceStreak,
  type HistoryEntry,
  type HistorySession,
} from './practice-history';
import { todayKeyFor } from './practice-storage';

/** Instante local del día indicado. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function entry(id: string, quality: number | null, comment: string | null = null): HistoryEntry {
  return {
    repertoireId: id,
    title: `Tune ${id}`,
    rhythm: 'reel',
    quality,
    comment,
    position: 0,
  };
}

function session(id: string, startedMs: number, entries: HistoryEntry[]): HistorySession {
  return { id, startedAt: new Date(startedMs).toISOString(), entries };
}

describe('buildHistoryDays', () => {
  it('agrupa por día local y no por el día UTC', () => {
    // 23:30 del 10 y 00:30 del 11 son días distintos, aunque en UTC puedan caer
    // en el mismo si la zona va por detrás.
    const days = buildHistoryDays([
      session('s1', at(2026, 11, 10, 23, 30), [entry('a', 3)]),
      session('s2', at(2026, 11, 11, 0, 30), [entry('b', null)]),
    ]);

    expect(days.map((day) => day.key)).toEqual([
      todayKeyFor(at(2026, 11, 11, 0, 30)),
      todayKeyFor(at(2026, 11, 10, 23, 30)),
    ]);
    expect(days[0].entries.map((e) => e.repertoireId)).toEqual(['b']);
    expect(days[1].entries.map((e) => e.repertoireId)).toEqual(['a']);
  });

  it('suma sesiones y ensayos del mismo día y deja la media de lo valorado', () => {
    const days = buildHistoryDays([
      session('s1', at(2026, 11, 11, 9), [entry('a', 5), entry('b', null)]),
      session('s2', at(2026, 11, 11, 20), [entry('c', 2)]),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ sessions: 2, practices: 3 });
    // La media ignora los ensayos sin puntuar: (5 + 2) / 2.
    expect(days[0].avgQuality).toBe(3.5);
  });

  it('sin valoraciones no hay media, y no se inventa un cero', () => {
    const [day] = buildHistoryDays([session('s1', at(2026, 11, 11, 9), [entry('a', null)])]);
    expect(day.avgQuality).toBeNull();
  });

  it('ordena los días del más reciente al más antiguo aunque lleguen desordenados', () => {
    const days = buildHistoryDays([
      session('s1', at(2026, 11, 9, 9), [entry('a', null)]),
      session('s2', at(2026, 11, 11, 9), [entry('b', null)]),
      session('s3', at(2026, 11, 10, 9), [entry('c', null)]),
    ]);

    expect(days.map((day) => day.key)).toEqual([
      todayKeyFor(at(2026, 11, 11, 9)),
      todayKeyFor(at(2026, 11, 10, 9)),
      todayKeyFor(at(2026, 11, 9, 9)),
    ]);
  });
});

describe('historySeries', () => {
  it('devuelve un punto por día del rango, con ceros incluidos, del antiguo a hoy', () => {
    const now = at(2026, 11, 11, 18);
    const days = buildHistoryDays([
      session('s1', at(2026, 11, 11, 9), [entry('a', null)]),
      session('s2', at(2026, 11, 9, 9), [entry('b', null), entry('c', null)]),
    ]);

    const points = historySeries(days, { nowMs: now, range: 4 });

    expect(points).toHaveLength(4);
    expect(points.map((point) => point.practices)).toEqual([0, 2, 0, 1]);
    expect(points[points.length - 1].isToday).toBe(true);
    expect(points.filter((point) => point.isToday)).toHaveLength(1);
  });

  it('la clave del último punto es el día de hoy, no la de mañana', () => {
    const now = at(2026, 11, 11, 23, 45);
    const points = historySeries([], { nowMs: now, range: 7 });
    expect(points[points.length - 1].key).toBe(todayKeyFor(now));
  });
});

describe('practiceStreak', () => {
  const points = (...counts: number[]) =>
    counts.map((practices, index) => ({
      key: `k${index}`,
      label: '',
      practices,
      isToday: index === counts.length - 1,
    }));

  it('cuenta los días seguidos que acaban hoy', () => {
    expect(practiceStreak(points(0, 3, 2, 1))).toBe(3);
  });

  it('un día todavía sin ensayar no rompe la racha: se cuenta desde ayer', () => {
    expect(practiceStreak(points(0, 4, 2, 0))).toBe(2);
  });

  it('sin ensayos no hay racha', () => {
    expect(practiceStreak(points(0, 0, 0))).toBe(0);
  });

  it('un hueco antes de ayer corta la cuenta', () => {
    expect(practiceStreak(points(5, 0, 2, 1))).toBe(2);
  });
});

describe('historyStats', () => {
  it('resume el rango y reparte las valoraciones', () => {
    const now = at(2026, 11, 11, 18);
    const days = buildHistoryDays([
      session('s1', at(2026, 11, 11, 9), [entry('a', 5), entry('b', 4)]),
      session('s2', at(2026, 11, 10, 9), [entry('a', 3), entry('c', null)]),
      session('s3', at(2026, 11, 8, 9), [entry('d', 1)]),
    ]);

    const stats = historyStats(days, { nowMs: now, range: 7 });

    expect(stats).toMatchObject({
      practices: 5,
      sessions: 3,
      activeDays: 3,
      streak: 2,
      ratedCount: 4,
      distinctTunes: 4,
    });
    expect(stats.avgQuality).toBeCloseTo(3.25, 2);
    expect(stats.distribution).toEqual([1, 0, 1, 1, 1]);
  });

  it('un rango vacío da ceros y ninguna media', () => {
    const stats = historyStats([], { nowMs: at(2026, 11, 11, 12), range: 30 });
    expect(stats).toMatchObject({
      practices: 0,
      sessions: 0,
      activeDays: 0,
      streak: 0,
      avgQuality: null,
      ratedCount: 0,
      distinctTunes: 0,
    });
    expect(stats.distribution).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('dayLabel', () => {
  const now = at(2026, 11, 11, 18);

  it('dice hoy y ayer con palabras', () => {
    expect(dayLabel(todayKeyFor(now), now)).toBe('Today');
    expect(dayLabel(todayKeyFor(at(2026, 11, 10, 9)), now)).toBe('Yesterday');
  });

  it('una fecha anterior se dice con el día de la semana y el mes', () => {
    expect(dayLabel(todayKeyFor(at(2026, 11, 8, 9)), now)).toBe('Sunday 8 November');
  });
});

describe('dayKeyOf', () => {
  it('usa la fecha local del instante ISO', () => {
    const ms = at(2026, 11, 11, 23, 30);
    expect(dayKeyOf(new Date(ms).toISOString())).toBe(todayKeyFor(ms));
  });
});
