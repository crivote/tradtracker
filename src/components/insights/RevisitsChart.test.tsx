// @vitest-environment jsdom
/**
 * Las revisitas (#22): los cuatro tramos por ratio, las tres cifras
 * (demasiado pronto / en banda / tarde) y la mediana en horas.
 *
 * `drawChart` va simulado: se miran las etiquetas, los recuentos, el color del
 * tramo que cumple y el texto del tooltip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';

vi.mock('../../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { drawChart } from '../../lib/charts';
import type { RevisitSummary } from '../../lib/insights';
import RevisitsChart from './RevisitsChart';
import { INSIGHT_PALETTE } from './palette';

const drawChartMock = vi.mocked(drawChart);

const SUMMARY: RevisitSummary = {
  pairs: 6,
  medianHours: 61.5,
  tooSoon: 1,
  inBand: 3,
  late: 2,
  buckets: [
    { key: 'under-0.5', label: '<0.5×', count: 1, pct: 16.7 },
    { key: '0.5-1', label: '0.5–1×', count: 3, pct: 50 },
    { key: '1-2', label: '1–2×', count: 1, pct: 16.7 },
    { key: '2+', label: '≥2×', count: 1, pct: 16.7 },
  ],
};

interface ReadDataset {
  label?: string;
  data: number[];
  backgroundColor: string[];
}

function dataset(): ReadDataset {
  return drawChartMock.mock.calls[0][1].data.datasets[0] as unknown as ReadDataset;
}

/** Las cuatro cifras de debajo, en el orden en que se pintan. */
function counts(): Array<{ value: string; label: string }> {
  return Array.from(document.querySelectorAll('.insight-counts li')).map((node) => ({
    value: node.querySelector('b')!.textContent!.trim(),
    label: node.querySelector('small')!.textContent!.trim(),
  }));
}

beforeEach(() => {
  drawChartMock.mockClear();
});

afterEach(() => cleanup());

describe('RevisitsChart', () => {
  it('pinta los cuatro tramos por ratio con el de en banda destacado', () => {
    render(() => <RevisitsChart summary={SUMMARY} />);

    expect(drawChartMock).toHaveBeenCalledTimes(1);
    const config = drawChartMock.mock.calls[0][1];
    expect(config.data.labels).toEqual(['<0.5×', '0.5–1×', '1–2×', '≥2×']);

    const bars = dataset();
    expect(bars.data).toEqual([1, 3, 1, 1]);
    // El tramo que cumple el intervalo va en tinta de acento; los demás, en gris.
    expect(bars.backgroundColor[1]).toBe(INSIGHT_PALETTE.accent);
    expect(bars.backgroundColor[0]).toBe(INSIGHT_PALETTE.faint);
    expect(bars.backgroundColor[3]).toBe(INSIGHT_PALETTE.faint);
  });

  it('el tooltip dice cuántos huecos y qué peso tienen', () => {
    render(() => <RevisitsChart summary={SUMMARY} />);

    const label = drawChartMock.mock.calls[0][1].options?.plugins?.tooltip?.callbacks
      ?.label as unknown as (item: { dataIndex: number }) => string;

    expect(label({ dataIndex: 1 })).toBe('3 gaps · 50.0%');
    expect(label({ dataIndex: 2 })).toBe('1 gap · 16.7%');
  });

  it('debajo van las tres cifras y la mediana en horas', () => {
    render(() => <RevisitsChart summary={SUMMARY} />);

    expect(counts()).toEqual([
      { value: '1', label: 'too soon' },
      { value: '3', label: 'in band' },
      { value: '2', label: 'late' },
      { value: '61.5 h', label: 'median gap' },
    ]);
    // La cifra que cumple va marcada: no todas pesan lo mismo.
    expect(document.querySelector('.insight-counts .is-in-band')).toBeTruthy();
  });

  it('sin dos pasadas de la misma tune lo dice y no pinta un canvas vacío', () => {
    render(() => (
      <RevisitsChart
        summary={{
          pairs: 0,
          medianHours: null,
          tooSoon: 0,
          inBand: 0,
          late: 0,
          buckets: SUMMARY.buckets.map((bucket) => ({ ...bucket, count: 0, pct: 0 })),
        }}
      />
    ));

    expect(drawChartMock).not.toHaveBeenCalled();
    expect(document.querySelector('.insight-canvas')).toBeNull();
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'No two passes of the same tune yet',
    );
  });
});
