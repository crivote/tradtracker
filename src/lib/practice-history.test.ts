/**
 * Modelo del historial (`/history`): agrupación por día, cifras y serie de la
 * gráfica. Todo es puro y se prueba sin red ni base.
 *
 * Desde #56 una marca es la tune **y el día**: `pr_practice.day` es un día local
 * («YYYY-MM-DD») que compuso el cliente, así que el modelo agrupa por esa clave
 * tal cual y no convierte instantes. Las claves se comparan con `todayKeyFor`
 * sobre fechas construidas en local: la prueba no depende de la zona horaria del
 * runner, que es justo el error que este código evita cometer.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHistoryDays,
  dayLabel,
  historySeries,
  historyStats,
  practiceStreak,
  rangeStartKey,
  type PracticeMark,
} from './practice-history';
import { todayKeyFor } from './practice-storage';

/** Instante local del día indicado. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/** Marca de una tune en un día local, tal y como llega de `pr_practice`. */
function mark(
  repertoireId: string,
  day: string,
  quality: number | null,
  comment: string | null = null,
): PracticeMark {
  return {
    day,
    repertoireId,
    title: `Tune ${repertoireId}`,
    rhythm: 'reel',
    quality,
    comment,
  };
}

/** Clave `YYYY-MM-DD` del día local del instante. */
function keyOf(ms: number): string {
  return todayKeyFor(ms);
}

describe('buildHistoryDays', () => {
  it('agrupa por el día local que trae la marca, sin convertirlo', () => {
    // Las 23:30 del 10 y las 00:30 del 11 son días distintos: el cliente ya
    // escribió el día local de cada ensayo, así que aquí no hay husos que valgan.
    const days = buildHistoryDays([
      mark('a', keyOf(at(2026, 11, 10, 23, 30)), 3),
      mark('b', keyOf(at(2026, 11, 11, 0, 30)), null),
    ]);

    expect(days.map((day) => day.key)).toEqual([keyOf(at(2026, 11, 11, 0, 30)), keyOf(at(2026, 11, 10, 23, 30))]);
    expect(days[0].entries.map((e) => e.repertoireId)).toEqual(['b']);
    expect(days[1].entries.map((e) => e.repertoireId)).toEqual(['a']);
  });

  it('suma los ensayos del mismo día y deja la media de lo valorado', () => {
    const day = keyOf(at(2026, 11, 11, 9));
    const days = buildHistoryDays([
      mark('a', day, 5),
      mark('b', day, null),
      mark('c', day, 2),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0].practices).toBe(3);
    // La media ignora los ensayos sin puntuar: (5 + 2) / 2.
    expect(days[0].avgQuality).toBe(3.5);
  });

  it('sin valoraciones no hay media, y no se inventa un cero', () => {
    const [day] = buildHistoryDays([mark('a', keyOf(at(2026, 11, 11, 9)), null)]);
    expect(day.avgQuality).toBeNull();
  });

  it('ordena los días del más reciente al más antiguo aunque lleguen desordenados', () => {
    const days = buildHistoryDays([
      mark('a', keyOf(at(2026, 11, 9, 9)), null),
      mark('b', keyOf(at(2026, 11, 11, 9)), null),
      mark('c', keyOf(at(2026, 11, 10, 9)), null),
    ]);

    expect(days.map((day) => day.key)).toEqual([
      keyOf(at(2026, 11, 11, 9)),
      keyOf(at(2026, 11, 10, 9)),
      keyOf(at(2026, 11, 9, 9)),
    ]);
  });
});

describe('historySeries', () => {
  it('devuelve un punto por día del rango, con ceros incluidos, del antiguo a hoy', () => {
    const now = at(2026, 11, 11, 18);
    const days = buildHistoryDays([
      mark('a', keyOf(at(2026, 11, 11, 9)), null),
      mark('b', keyOf(at(2026, 11, 9, 9)), null),
      mark('c', keyOf(at(2026, 11, 9, 9)), null),
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

describe('rangeStartKey', () => {
  it('el primer día del rango es local y no se descuadra con el cambio de hora', () => {
    // Del 21 al 28 de octubre de 2026 cae el cambio de hora en Europa: una resta
    // de 86 400 000 ms por día caería en el día de al lado.
    expect(rangeStartKey(at(2026, 10, 28, 12), 7)).toBe(keyOf(at(2026, 10, 22, 12)));
    expect(rangeStartKey(at(2026, 10, 28, 12), 1)).toBe(keyOf(at(2026, 10, 28, 12)));
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
      mark('a', keyOf(at(2026, 11, 11, 9)), 5),
      mark('b', keyOf(at(2026, 11, 11, 9)), 4),
      mark('a', keyOf(at(2026, 11, 10, 9)), 3),
      mark('c', keyOf(at(2026, 11, 10, 9)), null),
      mark('d', keyOf(at(2026, 11, 8, 9)), 1),
    ]);

    const stats = historyStats(days, { nowMs: now, range: 7 });

    expect(stats).toMatchObject({
      practices: 5,
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
