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

import { fetchPracticeHistory, type HistorySession } from '../lib/practice-history';
import History from './History';

const mockedFetch = vi.mocked(fetchPracticeHistory);

/** Instante local de hace `daysAgo` días, a mediodía. */
function daysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function session(
  id: string,
  startedAt: string,
  entries: Array<{ id: string; title: string; quality: number | null; comment?: string }>,
): HistorySession {
  return {
    id,
    startedAt,
    entries: entries.map((entry, index) => ({
      repertoireId: entry.id,
      title: entry.title,
      rhythm: 'reel',
      quality: entry.quality,
      comment: entry.comment ?? null,
      position: index,
    })),
  };
}

const TODAY = [
  session('s-1', daysAgo(0), [
    { id: 'a', title: 'The Morning Dew', quality: 5, comment: 'La B parte, más lenta' },
    { id: 'b', title: 'Cooley’s', quality: null },
  ]),
  session('s-2', daysAgo(1), [{ id: 'c', title: 'Drowsy Maggie', quality: 3 }]),
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

  it('un fallo de lectura se muestra con su mensaje y una salida', async () => {
    mockedFetch.mockRejectedValue(new Error('Could not load the practice history: boom'));
    mount();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
