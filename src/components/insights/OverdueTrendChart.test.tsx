// @vitest-environment jsdom
/**
 * La tendencia del vencimiento se pinta en **tasa**, no en recuento.
 *
 * `drawChart` va simulado: lo que se afirma es la configuración. La razón de la
 * tasa está medida en la base real: entre el 17 y el 21 de noviembre el
 * recuento pasó de 215 a 202 (una mejora de 9 puntos) mientras el censo crecía
 * de 310 a 336, así que la línea de absolutos se leía plana.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';

vi.mock('../../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { drawChart } from '../../lib/charts';
import type { OverdueTrend } from '../../lib/insights';
import OverdueTrendChart from './OverdueTrendChart';

const drawChartMock = vi.mocked(drawChart);

const TREND: OverdueTrend = {
  since: '30 Oct',
  windowDays: 30,
  points: [
    { key: '2026-11-19', label: '19 Nov', overdue: 203, judged: 330 },
    { key: '2026-11-20', label: '20 Nov', overdue: 208, judged: 330 },
    { key: '2026-11-21', label: '21 Nov', overdue: 202, judged: 336 },
  ],
};

function dataset(call = 0): { label?: string; data: number[] } {
  return drawChartMock.mock.calls[call][1].data.datasets![0] as unknown as {
    label?: string;
    data: number[];
  };
}

beforeEach(() => drawChartMock.mockClear());
afterEach(() => cleanup());

describe('OverdueTrendChart', () => {
  it('la línea es la tasa por día, no el recuento', () => {
    render(() => <OverdueTrendChart trend={TREND} />);

    expect(drawChartMock.mock.calls[0][1].data.labels).toEqual(['19 Nov', '20 Nov', '21 Nov']);
    expect(dataset().label).toBe('Overdue %');
    expect(dataset().data).toEqual([61.5, 63, 60.1]);
  });

  it('el tooltip conserva el recuento y su censo, con la tasa', () => {
    render(() => <OverdueTrendChart trend={TREND} />);

    const label = drawChartMock.mock.calls[0][1].options?.plugins?.tooltip?.callbacks
      ?.label as unknown as (item: { dataIndex: number }) => string;

    expect(label({ dataIndex: 0 })).toBe('203 of 330 overdue · 61.5%');
    expect(label({ dataIndex: 2 })).toBe('202 of 336 overdue · 60.1%');
  });

  it('el resumen accesible dice el recuento de hoy y su tasa', () => {
    render(() => <OverdueTrendChart trend={TREND} />);

    const label = document.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('202 of 336 overdue today (60.1%)');
  });
});
