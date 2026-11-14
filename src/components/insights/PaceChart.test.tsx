// @vitest-environment jsdom
/**
 * El ritmo del historial (#22): tunes distintas por día y la línea del plan.
 *
 * `drawChart` va simulado. Lo que se afirma es la configuración (una serie de
 * barras por día, una línea plana en `dailyTarget`), el pie con las vivas y que
 * un cambio de rango **repinta sin dejar la instancia anterior viva**.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

vi.mock('../../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { drawChart } from '../../lib/charts';
import type { HistoryPoint } from '../../lib/practice-history';
import PaceChart from './PaceChart';
import { INSIGHT_PALETTE } from './palette';

const drawChartMock = vi.mocked(drawChart);

/** Siete días con un hueco en medio: el cero es un dato, no un día que falte. */
const POINTS: HistoryPoint[] = [
  { key: '2026-11-08', label: '8 Nov', practices: 3, isToday: false },
  { key: '2026-11-09', label: '9 Nov', practices: 2, isToday: false },
  { key: '2026-11-10', label: '10 Nov', practices: 0, isToday: false },
  { key: '2026-11-11', label: '11 Nov', practices: 5, isToday: false },
  { key: '2026-11-12', label: '12 Nov', practices: 4, isToday: false },
  { key: '2026-11-13', label: '13 Nov', practices: 1, isToday: false },
  { key: '2026-11-14', label: '14 Nov', practices: 6, isToday: true },
];

interface ReadDataset {
  type?: string;
  label?: string;
  data: number[];
  backgroundColor?: string[];
  borderColor?: string;
  borderDash?: number[];
  pointRadius?: number;
}

function datasets(call = 0): ReadDataset[] {
  return drawChartMock.mock.calls[call][1].data.datasets as unknown as ReadDataset[];
}

beforeEach(() => {
  drawChartMock.mockClear();
});

afterEach(() => cleanup());

describe('PaceChart', () => {
  it('una barra por día del rango y una línea plana en el plan del usuario', () => {
    render(() => <PaceChart points={POINTS} range={7} dailyTarget={8} alive={5} />);

    expect(drawChartMock).toHaveBeenCalledTimes(1);

    const config = drawChartMock.mock.calls[0][1];
    expect(config.data.labels).toEqual(POINTS.map((point) => point.label));

    const [bars, plan] = datasets();
    expect(datasets()).toHaveLength(2);
    expect(bars.type).toBe('bar');
    expect(bars.data).toEqual([3, 2, 0, 5, 4, 1, 6]);
    // El día de hoy se marca con la tinta; los demás, con el acento.
    expect(bars.backgroundColor![6]).toBe(INSIGHT_PALETTE.ink);
    expect(bars.backgroundColor![0]).toBe(INSIGHT_PALETTE.accent);

    // La línea del plan: discontinua, sin puntos, al mismo valor todos los días.
    expect(plan.type).toBe('line');
    expect(plan.data).toEqual([8, 8, 8, 8, 8, 8, 8]);
    expect(plan.label).toBe('Plan · 8 a day');
    expect(plan.borderDash).toEqual([5, 4]);
    expect(plan.pointRadius).toBe(0);
  });

  it('el tooltip distingue lo practicado del plan', () => {
    render(() => <PaceChart points={POINTS} range={7} dailyTarget={8} alive={5} />);

    const callbacks = drawChartMock.mock.calls[0][1].options?.plugins?.tooltip?.callbacks
      ?.label as unknown as (item: { parsed: { y: number }; datasetIndex: number }) => string;

    expect(callbacks({ parsed: { y: 3 }, datasetIndex: 0 })).toBe('3 tunes');
    expect(callbacks({ parsed: { y: 1 }, datasetIndex: 0 })).toBe('1 tune');
    expect(callbacks({ parsed: { y: 8 }, datasetIndex: 1 })).toBe('Plan · 8 a day');
  });

  it('debajo dice cuántas tunes siguen vivas en 14 días', () => {
    render(() => <PaceChart points={POINTS} range={7} dailyTarget={8} alive={5} />);

    const foot = document.querySelector('.insight-foot')!.textContent!.replace(/\s+/g, ' ');
    expect(foot).toContain('5 tunes alive in the last 14 days');
  });

  it('un rango sin ensayos lo dice con palabras y no pinta un canvas vacío', () => {
    const empty = POINTS.map((point) => ({ ...point, practices: 0 }));
    render(() => <PaceChart points={empty} range={7} dailyTarget={8} alive={0} />);

    expect(drawChartMock).not.toHaveBeenCalled();
    expect(document.querySelector('.insight-canvas')).toBeNull();
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'No practices in the last 7 days',
    );
  });

  it('cambiar el rango de la serie vuelve a pintar y destruye la instancia anterior', async () => {
    // Como en la ruta: el rango no solo titula, cambia la serie (30 puntos).
    const [view, setView] = createSignal({ range: 7, points: POINTS });
    render(() => (
      <PaceChart points={view().points} range={view().range} dailyTarget={8} alive={5} />
    ));

    const first = drawChartMock.mock.results[0].value as unknown as { destroy: () => void };
    expect(drawChartMock).toHaveBeenCalledTimes(1);

    setView({ range: 30, points: POINTS.slice(0, 3) });

    await waitFor(() => expect(drawChartMock).toHaveBeenCalledTimes(2));
    // Una instancia viva por canvas, nunca dos: la primera se destruye al repintar.
    expect(first.destroy).toHaveBeenCalled();
    expect(drawChartMock.mock.calls[1][1].data.labels).toHaveLength(3);
  });
});
