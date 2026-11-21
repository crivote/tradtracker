// @vitest-environment jsdom
/**
 * La pantalla del historial: cableado de la ruta, no el modelo (ese se prueba en
 * `practice-history.test.ts`). Aquí se comprueba que lee al montar, que pinta los
 * días con sus valoraciones y que cambiar el rango vuelve a leer con el rango
 * nuevo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/practice-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/practice-history')>();
  return { ...actual, fetchPracticeHistory: vi.fn() };
});

/**
 * El panel (#22) pide las marcas del corte A, los eventos de escalera y las filas
 * del repertorio (para la composición y las revisitas), y pinta con Chart.js.
 * Aquí lo que se prueba es el cableado de la pantalla: los tres adaptadores van
 * simulados y `drawChart` también, porque jsdom no tiene canvas.
 */
vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return { ...actual, fetchRepertoire: vi.fn() };
});

vi.mock('../lib/insights-data', () => ({
  INSIGHT_ROW_LIMIT: 5000,
  fetchInsightMarks: vi.fn(async () => []),
  fetchInsightEvents: vi.fn(async () => []),
}));

vi.mock('../lib/charts', () => ({
  drawChart: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { fetchPracticeHistory, type PracticeMark } from '../lib/practice-history';
import { fetchRepertoire } from '../lib/repertoire';
import { fetchInsightEvents, fetchInsightMarks } from '../lib/insights-data';
import { todayKeyFor } from '../lib/practice-storage';
import History from './History';

const mockedFetch = vi.mocked(fetchPracticeHistory);
const mockedRows = vi.mocked(fetchRepertoire);
const mockedMarks = vi.mocked(fetchInsightMarks);
const mockedEvents = vi.mocked(fetchInsightEvents);

/** Día local (`YYYY-MM-DD`) de hace `daysAgo` días: es lo que guarda la base. */
function daysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return todayKeyFor(date.getTime());
}

/** Una marca del historial: una tune en un día, como la devuelve el adaptador. */
function mark(
  day: string,
  entries: Array<{ id: string; title: string; quality: number | null; comment?: string }>,
): PracticeMark[] {
  return entries.map((entry) => ({
    day,
    repertoireId: entry.id,
    title: entry.title,
    rhythm: 'reel',
    quality: entry.quality,
    comment: entry.comment ?? null,
  }));
}

const TODAY = [
  ...mark(daysAgo(0), [
    { id: 'a', title: 'The Morning Dew', quality: 5, comment: 'La B parte, más lenta' },
    { id: 'b', title: 'Cooley’s', quality: null },
  ]),
  ...mark(daysAgo(1), [{ id: 'c', title: 'Drowsy Maggie', quality: 3 }]),
];

function mount() {
  const history = createMemoryHistory();
  history.set({ value: '/history' });
  render(() => (
    <MemoryRouter history={history}>
      <Route path="/history" component={History} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(TODAY);
  // El panel se carga aparte y con datos vacíos: no es lo que prueba este fichero.
  mockedRows.mockReset();
  mockedRows.mockResolvedValue([]);
  mockedMarks.mockReset();
  mockedMarks.mockResolvedValue([]);
  mockedEvents.mockReset();
  mockedEvents.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('History', () => {
  it('lee al montar y pinta el resumen y los días', async () => {
    mount();

    await waitFor(() => expect(screen.getByText('Practice history')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('The Morning Dew')).toBeTruthy());

    expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ range: 30 }));
    // Tres ensayos con dos tunes distintas.
    expect(screen.getByText('Drowsy Maggie')).toBeTruthy();
    expect(screen.getByText('Cooley’s')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeTruthy();
    expect(screen.getByText('not rated')).toBeTruthy();
    expect(screen.getByText('La B parte, más lenta')).toBeTruthy();
  });

  it('la gráfica lleva un carril por día del rango, también los vacíos', async () => {
    mount();

    await waitFor(() => expect(screen.getByRole('img', { name: /Practices per day/ })).toBeTruthy());
    const bars = document.querySelectorAll('.chart-bar');
    expect(bars).toHaveLength(30);
    expect(document.querySelectorAll('.chart-bar.is-empty').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.chart-bar.is-today')).toHaveLength(1);
  });

  it('cada sesión llega plegada, con su línea de resumen a la vista', async () => {
    mount();

    await waitFor(() =>
      expect(document.querySelectorAll('details.history-day').length).toBe(2),
    );
    const days = [...document.querySelectorAll<HTMLDetailsElement>('details.history-day')];

    // Plegadas por defecto: el detalle existe en el DOM pero no se ve.
    expect(days.every((day) => day.open === false)).toBe(true);

    // La línea de resumen da fecha, número de tunes y su media.
    const summary = days[0].querySelector('.history-day__summary')!;
    expect(summary.querySelector('h2')!.textContent).toBe('Today');
    expect(summary.textContent).toContain('2 tunes');
    expect(summary.textContent).toContain('avg 5.0');

    // Y el detalle sigue dentro: es un acordeón, no una lista recortada.
    expect(days[0].querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('las medias por sesión van arriba, con sus dos gráficas', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('.session-averages')).toBeTruthy());

    const figures = [...document.querySelectorAll('.session-figure')];
    expect(figures).toHaveLength(2);
    // Dos sesiones de 2 y 1 tunes: 1.5 de media; la valoración, (5 + 3) / 2 = 4.0.
    expect(figures[0].textContent).toContain('1.5');
    expect(figures[0].textContent).toContain('tunes per session');
    expect(figures[1].textContent).toContain('4.0');
    expect(figures[1].textContent).toContain('rating per session');
    // Una barra por sesión, no por día del rango: dos, no treinta.
    expect(figures[0].querySelectorAll('.session-bar')).toHaveLength(2);
  });

  it('cambiar el rango vuelve a leer con el rango nuevo', async () => {
    mount();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch.mock.calls[1][0]).toMatchObject({ range: 7 });
    expect(document.querySelectorAll('.chart-bar')).toHaveLength(7);
  });

  it('un rango sin ensayos lo dice y no pinta una lista vacía', async () => {
    mockedFetch.mockResolvedValue([]);
    mount();

    await waitFor(() => expect(screen.getByText(/Nothing recorded in the last 30 days/)).toBeTruthy());
    expect(document.querySelector('.history-days')).toBeNull();
  });

  it('el panel de estado va después de la lista de días, con las tres gráficas', async () => {
    // Marcas y filas reales para el panel: una tune con dos pasadas y su peldaño.
    mockedMarks.mockResolvedValue([
      { repertoireId: 'a', day: daysAgo(1), practicedAt: new Date(Date.now() - 86_400_000).toISOString() },
      { repertoireId: 'a', day: daysAgo(0), practicedAt: new Date().toISOString() },
    ]);
    mockedRows.mockResolvedValue([
      {
        id: 'a',
        status: 'shaky',
        shelved: false,
        added_at: '2026-10-01T10:00:00Z',
        last_practiced_day: daysAgo(0),
        tune: { id: 't-a', origin: 'thesession', origin_ref: '1', name: 'A', rhythm: 'reel', meter: '4/4', key: null, abc: null },
      } as any,
    ]);

    mount();

    const panel = await waitFor(() => {
      const node = document.querySelector('.history-insights');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });

    // Ritmo, composición y revisitas: tres tarjetas, ninguna con canvas vacío.
    expect(panel.querySelectorAll('.insight-card')).toHaveLength(3);
    expect(panel.querySelector('.insight-card--pace')).toBeTruthy();
    expect(panel.querySelector('.insight-card--composition')).toBeTruthy();
    expect(panel.querySelector('.insight-card--revisits')).toBeTruthy();

    // Y va **después** de los días, no antes: el diario manda.
    const days = document.querySelector('.history-days') as HTMLElement;
    expect(days.compareDocumentPosition(panel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('si el panel no puede leer, lo dice y los días siguen en pantalla', async () => {
    mockedMarks.mockRejectedValue(new Error('boom'));

    mount();

    const alert = await waitFor(() => {
      const node = screen.getByText('Could not load the statistics.');
      expect(node.getAttribute('role')).toBe('alert');
      return node;
    });
    expect(alert).toBeTruthy();
    expect(document.querySelector('.history-days')).toBeTruthy();
    expect(document.querySelector('.history-insights')).toBeNull();
  });

  it('un fallo de lectura se muestra con su mensaje y una salida', async () => {
    mockedFetch.mockRejectedValue(new Error('Could not load the practice history: boom'));
    mount();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
