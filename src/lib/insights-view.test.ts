// @vitest-environment node
/**
 * La vista del panel (#22): pasar de marcas a serie, contar vivas, la racha y
 * las dos etiquetas de fecha. Nada de esto decide umbrales —los trae el corte A—
 * y por eso se prueba aparte, con el instante inyectado.
 */
import { describe, expect, it } from 'vitest';
import type { InsightEvent, InsightMark } from './insights';
import {
  aliveInRange,
  ladderHistorySince,
  paceSeries,
  previousSundayLabel,
  streakFromMarks,
  tunesPerDay,
} from './insights-view';
import { todayKeyFor } from './practice-storage';

/** Sábado 14 de noviembre de 2026, a media mañana. */
const NOW = new Date(2026, 10, 14, 10, 0, 0).getTime();

/** Clave de día local de hace `daysAgo` días. */
function day(daysAgo: number): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return todayKeyFor(date.getTime());
}

function mark(repertoireId: string, daysAgo: number): InsightMark {
  return { repertoireId, day: day(daysAgo), practicedAt: `${day(daysAgo)}T10:00:00Z` };
}

describe('tunesPerDay', () => {
  it('cuenta una tune por día aunque llegue dos veces', () => {
    const counts = tunesPerDay([
      mark('a', 0),
      mark('a', 0),
      mark('b', 0),
      mark('a', 1),
    ]);

    expect(counts.get(day(0))).toBe(2);
    expect(counts.get(day(1))).toBe(1);
  });
});

describe('aliveInRange', () => {
  it('cuenta tunes distintas dentro de la ventana y deja fuera las de antes', () => {
    const marks = [
      mark('a', 0),
      mark('b', 5),
      mark('c', 13),
      // Justo fuera de los 14 días: el día 14 anterior es el primero que no entra.
      mark('d', 14),
    ];

    expect(aliveInRange(marks, NOW, 14)).toBe(3);
    expect(aliveInRange(marks, NOW, 7)).toBe(2);
  });
});

describe('paceSeries', () => {
  it('devuelve un punto por día del rango, con ceros donde no hubo ensayo', () => {
    const points = paceSeries([mark('a', 0), mark('b', 0), mark('c', 2)], {
      nowMs: NOW,
      range: 7,
    });

    expect(points).toHaveLength(7);
    expect(points.map((point) => point.key)).toEqual([
      day(6),
      day(5),
      day(4),
      day(3),
      day(2),
      day(1),
      day(0),
    ]);
    expect(points.map((point) => point.practices)).toEqual([0, 0, 0, 0, 1, 0, 2]);
    expect(points[6].isToday).toBe(true);
    expect(points.filter((point) => point.isToday)).toHaveLength(1);
  });
});

describe('streakFromMarks', () => {
  it('cuenta los días consecutivos desde hoy, con la mejor y la anterior', () => {
    const marks = [mark('a', 0), mark('b', 1), mark('c', 2)];
    expect(streakFromMarks(marks, NOW)).toEqual({ current: 3, best: 3, previous: 0 });
  });

  it('un día sin ensayo corta la racha: no se salta el hueco', () => {
    // Racha de dos (hoy y ayer), hueco en el día 2, y otra de dos antes.
    const marks = [mark('a', 0), mark('b', 1), mark('c', 3), mark('d', 4)];
    expect(streakFromMarks(marks, NOW)).toEqual({ current: 2, best: 2, previous: 2 });
  });

  it('sin ensayos hoy la racha empieza ayer, y sin nada es cero', () => {
    expect(streakFromMarks([mark('a', 1), mark('b', 2)], NOW)).toEqual({
      current: 2,
      best: 2,
      previous: 0,
    });
    expect(streakFromMarks([], NOW)).toEqual({ current: 0, best: 0, previous: 0 });
  });

  it('la mejor racha es la de toda la ventana, no la última', () => {
    // Cinco días seguidos hace dos semanas, y luego rachas cortas.
    const marks = [
      mark('a', 0),
      ...Array.from({ length: 5 }, (_, index) => mark(`b${index}`, 14 + index)),
    ];
    expect(streakFromMarks(marks, NOW)).toMatchObject({ current: 1, best: 5 });
  });
});

describe('previousSundayLabel', () => {
  it('nombra el domingo de la semana pasada, que es la frontera del delta', () => {
    // Sábado 14 de noviembre de 2026 → domingo 8.
    expect(previousSundayLabel(NOW)).toBe('Sunday 8');
  });
});

describe('ladderHistorySince', () => {
  it('toma el primer evento de estado, ignorando aparcadas e instantes ilegibles', () => {
    const events: InsightEvent[] = [
      {
        repertoireId: 'a',
        kind: 'shelved',
        fromValue: null,
        toValue: 'true',
        at: '2026-10-01T09:00:00Z',
        source: 'backfill',
      },
      {
        repertoireId: 'a',
        kind: 'status',
        fromValue: null,
        toValue: 'learning',
        at: '2026-10-30T09:00:00Z',
        source: 'backfill',
      },
      {
        repertoireId: 'b',
        kind: 'status',
        fromValue: 'learning',
        toValue: 'shaky',
        at: 'not-a-date',
        source: 'ui',
      },
    ];

    expect(ladderHistorySince(events)).toBe('30 Oct');
    expect(ladderHistorySince([])).toBeNull();
  });
});
