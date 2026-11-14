// @vitest-environment jsdom
/**
 * El histograma del vencimiento (#22): los seis tramos, la barra de `sin
 * registro` aparte —con su hueco— y el delta contra el domingo pasado.
 *
 * `drawChart` va simulado: lo que se comprueba es la **configuración** que se le
 * pasa (etiquetas, datos, colores, tooltips), no el canvas, que en jsdom no
 * existe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';

vi.mock('../../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { drawChart } from '../../lib/charts';
import type { OverdueDelta, OverdueHistogram as Histogram } from '../../lib/insights';
import OverdueHistogram from './OverdueHistogram';
import { INSIGHT_PALETTE } from './palette';

const drawChartMock = vi.mocked(drawChart);

/** Sábado 14 de noviembre de 2026: el domingo de comparación es el día 8. */
const NOW = new Date(2026, 10, 14, 10, 0, 0).getTime();

const HISTOGRAM: Histogram = {
  universe: 20,
  sinRegistro: 5,
  buckets: [
    { key: '0-3', label: '0–3', count: 4, pct: 20 },
    { key: '4-7', label: '4–7', count: 3, pct: 15 },
    { key: '8-14', label: '8–14', count: 2, pct: 10 },
    { key: '15-30', label: '15–30', count: 3, pct: 15 },
    { key: '31-60', label: '31–60', count: 2, pct: 10 },
    { key: '60+', label: '60+', count: 1, pct: 5 },
  ],
  byBand: [
    { band: 'learning', practiced: 3, overdue: 2, pct: 66.7 },
    { band: 'shaky', practiced: 3, overdue: 2, pct: 66.7 },
    { band: 'playing_along', practiced: 3, overdue: 1, pct: 33.3 },
    { band: 'solo_ready', practiced: 3, overdue: 1, pct: 33.3 },
    { band: 'mastered', practiced: 3, overdue: 1, pct: 33.3 },
  ],
  overdue: 7,
  overduePct: 46.7,
};

const DELTA: OverdueDelta = {
  currentPct: 46.7,
  previousPct: 28.4,
  deltaPp: 18.3,
  byBand: [],
  enoughHistory: true,
};

/** Los datasets tal y como los lee la prueba: sin la unión de tipos de Chart.js. */
interface ReadDataset {
  label?: string;
  data: Array<number | null>;
  backgroundColor: string[];
}

function datasetOf(index = 0): ReadDataset {
  const config = drawChartMock.mock.calls[index][1];
  return config.data.datasets[0] as unknown as ReadDataset;
}

/** Invoca el callback del tooltip de un índice de barra concreto. */
function tooltipLabel(dataIndex: number): string {
  const config = drawChartMock.mock.calls[0][1];
  const label = config.options?.plugins?.tooltip?.callbacks?.label;
  return (label as unknown as (item: { dataIndex: number }) => string)({ dataIndex });
}

beforeEach(() => {
  drawChartMock.mockClear();
});

afterEach(() => cleanup());

describe('OverdueHistogram', () => {
  it('pinta los seis tramos con la barra de sin registro primera y un hueco entre medias', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    // El canvas existe y lleva nombre accesible; el dibujo lo resuelve drawChart.
    expect(screen.getByRole('img', { name: /Days since the last practice/ })).toBeTruthy();
    expect(drawChartMock).toHaveBeenCalledTimes(1);

    const config = drawChartMock.mock.calls[0][1];
    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(['No record', '', '0–3', '4–7', '8–14', '15–30', '31–60', '60+']);

    const dataset = datasetOf();
    // `sin registro` primero, luego el hueco (`null`, no un cero) y los seis tramos.
    expect(dataset.data).toEqual([5, null, 4, 3, 2, 3, 2, 1]);
    expect(dataset.backgroundColor[0]).toBe(INSIGHT_PALETTE.noRecord);
    expect(dataset.backgroundColor[0]).not.toBe(dataset.backgroundColor[2]);
    expect(dataset.backgroundColor[2]).toBe(INSIGHT_PALETTE.accent);
  });

  it('el tooltip dice «N tunes · X %» con el peso de cada tramo', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    expect(tooltipLabel(0)).toBe('5 tunes · 25.0%');
    expect(tooltipLabel(2)).toBe('4 tunes · 20.0%');
    expect(tooltipLabel(7)).toBe('1 tune · 5.0%');
  });

  it('debajo va el delta contra el domingo de la semana pasada', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    const delta = document.querySelector('.insight-delta')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(delta).toContain('46.7%');
    expect(delta).toContain('+18.3 pp vs Sunday 8');
  });

  it('sin historial suficiente no enseña cifra: dice que aún no lo hay', () => {
    render(() => (
      <OverdueHistogram
        histogram={HISTOGRAM}
        delta={{ ...DELTA, enoughHistory: false, currentPct: 0, previousPct: 0, deltaPp: 0 }}
        nowMs={NOW}
      />
    ));

    const delta = document.querySelector('.insight-delta')!;
    expect(delta.textContent).toBe('No history yet');
    expect(delta.classList.contains('insight-delta--none')).toBe(true);
    expect(delta.textContent).not.toContain('pp');
  });

  it('sin nada en rotación pinta el texto de vacío y no un canvas vacío', () => {
    render(() => (
      <OverdueHistogram
        histogram={{ ...HISTOGRAM, universe: 0, sinRegistro: 0, overdue: 0, overduePct: 0 }}
        delta={{ ...DELTA, enoughHistory: false }}
        nowMs={NOW}
      />
    ));

    expect(drawChartMock).not.toHaveBeenCalled();
    expect(document.querySelector('.insight-canvas')).toBeNull();
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'No tune is in rotation yet',
    );
  });
});
