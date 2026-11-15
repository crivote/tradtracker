// @vitest-environment jsdom
/**
 * El histograma del vencimiento (#22, revisado en #65): los siete tramos —sin la
 * barra de `sin registro`, que vive en la tarjeta— y el delta en recuentos sobre
 * el mismo censo.
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

/** Veinte en rotación: 5 sin registro y 15 con día, repartidas en siete tramos. */
const HISTOGRAM: Histogram = {
  universe: 20,
  sinRegistro: 5,
  buckets: [
    { key: '0-3', label: '0–3', count: 4, pct: 26.7 },
    { key: '4-7', label: '4–7', count: 3, pct: 20 },
    { key: '8-14', label: '8–14', count: 2, pct: 13.3 },
    { key: '15-30', label: '15–30', count: 3, pct: 20 },
    { key: '31-60', label: '31–60', count: 2, pct: 13.3 },
    { key: '61-90', label: '61–90', count: 1, pct: 6.7 },
    { key: '90+', label: '90+', count: 0, pct: 0 },
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
  currentOverdue: 7,
  previousOverdue: 5,
  census: 15,
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
  it('pinta los siete tramos y ninguna barra de sin registro: esa cifra vive en la tarjeta', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    // El canvas existe y lleva nombre accesible; el dibujo lo resuelve drawChart.
    expect(screen.getByRole('img', { name: /Days since the last practice/ })).toBeTruthy();
    expect(drawChartMock).toHaveBeenCalledTimes(1);

    const config = drawChartMock.mock.calls[0][1];
    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(['0–3', '4–7', '8–14', '15–30', '31–60', '61–90', '90+']);

    const dataset = datasetOf();
    expect(dataset.data).toEqual([4, 3, 2, 3, 2, 1, 0]);
    // Una sola tinta: no hay barra gris de dato ausente que separar del resto.
    expect(new Set(dataset.backgroundColor)).toEqual(new Set([INSIGHT_PALETTE.accent]));
  });

  it('la cabecera dice cuántas quedan fuera de la gráfica', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    const note = document.querySelector('.insight-note')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(note).toBe('15 with a record · 5 without');
  });

  it('el tooltip dice «N tunes · X %» con el peso de cada tramo sobre las que tienen día', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    expect(tooltipLabel(0)).toBe('4 tunes · 26.7%');
    expect(tooltipLabel(5)).toBe('1 tune · 6.7%');
    // Un tramo vacío también contesta, con su cero: no se calla el hueco.
    expect(tooltipLabel(6)).toBe('0 tunes · 0.0%');
  });

  it('debajo va el delta en recuentos sobre el mismo censo, no un segundo porcentaje', () => {
    render(() => <OverdueHistogram histogram={HISTOGRAM} delta={DELTA} nowMs={NOW} />);

    const delta = document.querySelector('.insight-delta')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(delta).toBe('5 of 15 overdue on Sunday 8 → 7 today · +18.3 pp');
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

  it('sin ninguna tune con registro pinta el texto de vacío y no un canvas vacío', () => {
    render(() => (
      <OverdueHistogram
        histogram={{
          ...HISTOGRAM,
          universe: 5,
          sinRegistro: 5,
          buckets: HISTOGRAM.buckets.map((bucket) => ({ ...bucket, count: 0, pct: 0 })),
          overdue: 0,
          overduePct: 0,
        }}
        delta={{ ...DELTA, enoughHistory: false }}
        nowMs={NOW}
      />
    ));

    expect(drawChartMock).not.toHaveBeenCalled();
    expect(document.querySelector('.insight-canvas')).toBeNull();
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'No tune in rotation has a practice recorded yet',
    );
  });
});
