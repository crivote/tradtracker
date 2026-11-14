// @vitest-environment jsdom
/**
 * La composición por semana (#22): cinco peldaños apilados, el gris de
 * `sinEstado` y las dos interacciones del corte —leyenda que enciende y apaga
 * (la de Chart.js, no se prueba el canvas) y **clic en un peldaño que navega** a
 * `/level/<band>`—.
 *
 * La navegación se prueba con un router de verdad: una ruta de sonda que escribe
 * el peldaño recibido. Así se comprueba el destino, no que se haya llamado a una
 * función.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory, useParams } from '@solidjs/router';

vi.mock('../../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { drawChart } from '../../lib/charts';
import type { WeekComposition } from '../../lib/insights';
import CompositionChart from './CompositionChart';
import { INSIGHT_PALETTE, bandColor } from './palette';

const drawChartMock = vi.mocked(drawChart);

const WEEKS: WeekComposition[] = [
  {
    key: '2026-10-26',
    label: '26 Oct',
    total: 10,
    byBand: { learning: 1, shaky: 2, playing_along: 1, solo_ready: 1, mastered: 0 },
    sinEstado: 5,
  },
  {
    key: '2026-11-02',
    label: '2 Nov',
    total: 10,
    byBand: { learning: 2, shaky: 1, playing_along: 2, solo_ready: 0, mastered: 1 },
    sinEstado: 4,
  },
  {
    key: '2026-11-09',
    label: '9 Nov',
    total: 10,
    byBand: { learning: 1, shaky: 1, playing_along: 1, solo_ready: 1, mastered: 1 },
    sinEstado: 5,
  },
];

interface ReadDataset {
  type?: string;
  label?: string;
  data: number[];
  backgroundColor: string;
  stack?: string;
}

function datasets(): ReadDataset[] {
  return drawChartMock.mock.calls[0][1].data.datasets as unknown as ReadDataset[];
}

/** La ruta de sonda: dice qué peldaño ha recibido el router. */
function LevelProbe() {
  const params = useParams<{ band: string }>();
  return <p>level: {params.band}</p>;
}

function mount(weeks: WeekComposition[] = WEEKS, ladderSince: string | null = '30 Oct') {
  const history = createMemoryHistory();
  history.set({ value: '/' });
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route
        path="/"
        component={() => <CompositionChart weeks={weeks} ladderSince={ladderSince} />}
      />
      <Route path="/level/:band" component={LevelProbe} />
    </MemoryRouter>
  ));
  return { history, ...view };
}

/** Pincha un segmento: lo que Chart.js entrega es el dataset y el índice. */
function clickSegment(datasetIndex: number) {
  const onClick = drawChartMock.mock.calls[0][1].options?.onClick as unknown as (
    event: null,
    elements: Array<{ datasetIndex: number; index: number }>,
  ) => void;
  onClick(null, [{ datasetIndex, index: 2 }]);
}

beforeEach(() => {
  drawChartMock.mockClear();
});

afterEach(() => cleanup());

describe('CompositionChart', () => {
  it('apila los cinco peldaños y el gris de sinEstado, en ese orden', () => {
    mount();

    const config = drawChartMock.mock.calls[0][1];
    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(['26 Oct', '2 Nov', '9 Nov']);

    const all = datasets();
    expect(all).toHaveLength(6);
    expect(all.map((dataset) => dataset.label)).toEqual([
      'Learning',
      'Shaky',
      'Playing along',
      'Solo-ready',
      'Mastered',
      'No level yet',
    ]);

    // Un peldaño = un dataset = una serie de la semana, y todos en la misma pila.
    expect(all[0].data).toEqual([1, 2, 1]);
    expect(all[4].data).toEqual([0, 1, 1]);
    expect(all.every((dataset) => dataset.stack === 'ladder')).toBe(true);
    expect(all[0].backgroundColor).toBe(bandColor('learning'));
    // El gris de las semanas sin estado no es el color de ningún peldaño.
    expect(all[5].backgroundColor).toBe(INSIGHT_PALETTE.unknown);
  });

  it('pinchar un segmento de peldaño navega a su listado', async () => {
    mount();

    clickSegment(3);

    await waitFor(() => expect(screen.getByText('level: solo_ready')).toBeTruthy());
  });

  it('pinchar «sin estado» no navega: no hay listado de lo que no se sabe', async () => {
    mount();

    clickSegment(5);

    // Un ciclo de tareas de por medio: si navegara, ya se vería.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/level:/)).toBeNull();
    expect(document.querySelector('.insight-canvas')).toBeTruthy();
  });

  it('si todas las semanas salen sin estado lo dice, con la fecha del primer evento', () => {
    const unknownWeeks: WeekComposition[] = WEEKS.map((week) => ({
      ...week,
      byBand: { learning: 0, shaky: 0, playing_along: 0, solo_ready: 0, mastered: 0 },
    }));
    mount(unknownWeeks, '30 Oct');

    const note = document.querySelector('.insight-foot--note')!.textContent!;
    expect(note).toContain('The ladder only has history since 30 Oct');
    // El gris sigue pintándose: la falta de estado también es el dato.
    expect(drawChartMock).toHaveBeenCalledTimes(1);
  });

  it('sin semanas no hay gráfica, solo el texto de vacío', () => {
    mount([]);

    expect(drawChartMock).not.toHaveBeenCalled();
    expect(document.querySelector('.insight-canvas')).toBeNull();
    expect(document.querySelector('.insights-empty')!.textContent).toContain('No weeks to show yet');
  });
});
