// @vitest-environment jsdom
/**
 * Vista de búsqueda del repertorio (#9).
 *
 * Lo que se prueba aquí es el cableado de la pantalla: que arranque vacía, que
 * el texto poble la rejilla con las cartas que casan, que el filtro de ritmo
 * acote y que la carta diga el peldaño —que la home no dice—. El filtrado en sí
 * es del modelo puro y se ejercita en `repertoire-model.test.ts`; el doble de
 * `fetchRepertoire` se hace con `importOriginal` justo para que las funciones
 * puras sigan siendo las reales y no una reimplementación de mentira.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    fetchRepertoire: vi.fn(),
  };
});

vi.mock('../lib/practice', () => ({
  logPractice: vi.fn(async () => undefined),
}));

import { fetchRepertoire } from '../lib/repertoire';
import Search from './Search';

const mockedFetch = vi.mocked(fetchRepertoire);

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'row-a',
    status: 'to_learn',
    shelved: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: null,
    added_at: '2026-10-01T10:00:00Z',
    last_practiced_at: null,
    tune: {
      id: 'tune-a',
      origin: 'thesession',
      origin_ref: '55',
      name: 'Morning Dew',
      rhythm: 'reel',
      meter: '4/4',
      key: 'D',
      abc: null,
    },
    image: null,
    practice_count: null,
    avg_quality: null,
    days_since_last_practice: null,
    ...overrides,
  };
}

/**
 * Cuatro tunes: tres reels (una de ellas aparcada, en otro peldaño) y un jig.
 * Las aparcadas también tienen que salir: la búsqueda cruza el repertorio entero.
 */
const ROWS = [
  row({
    id: 'row-cooley',
    status: 'playing_along',
    tune: { ...row().tune, id: 't1', name: 'Cooley’s Reel', rhythm: 'reel', key: 'D' },
  }),
  row({
    id: 'row-banshee',
    status: 'to_learn',
    tune: { ...row().tune, id: 't2', name: 'The Banshee', rhythm: 'jig', key: null },
  }),
  row({
    id: 'row-sligo',
    status: 'solo_ready',
    shelved: true,
    tune: { ...row().tune, id: 't3', name: 'Sligo Creek', rhythm: 'reel', key: 'G' },
  }),
  row({
    id: 'row-morning',
    status: 'learning',
    tune: { ...row().tune, id: 't4', name: 'Morning Dew', rhythm: 'reel', key: 'D' },
  }),
];

function renderSearch() {
  const history = createMemoryHistory();
  history.set({ value: '/search' });
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route path="/search" component={Search} />
    </MemoryRouter>
  ));
  return { history, ...view };
}

/** Las cartas pintadas, en el orden del DOM. */
function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.repertoire-home .card'));
}

function cardTitles(): string[] {
  return cards().map((card) => card.querySelector('h2')?.textContent?.trim() ?? '');
}

function cardFor(title: string): HTMLElement {
  const found = cards().find((card) => card.querySelector('h2')?.textContent?.trim() === title);
  if (!found) throw new Error(`No card for “${title}”`);
  return found;
}

function typeTerm(value: string) {
  const input = screen.getByLabelText('Search tunes by title') as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
}

function pickRhythm(value: string) {
  const select = screen.getByLabelText('Filter by rhythm') as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(ROWS as any);
});

afterEach(() => cleanup());

describe('vista de búsqueda del repertorio (#9)', () => {
  it('al entrar no hay ninguna carta: solo la línea de ayuda', async () => {
    renderSearch();

    await waitFor(() =>
      expect(screen.getByText(/Type a title — or pick a rhythm/)).toBeTruthy()
    );
    expect(cards()).toHaveLength(0);
    // Las cuatro tunes están cargadas: la vista vacía es una decisión, no un fallo.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('al teclear un título parcial aparecen solo las que casan', async () => {
    renderSearch();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    typeTerm('coo');

    await waitFor(() => expect(cardTitles()).toEqual(['Cooley’s Reel']));
    expect(screen.getByText('1 tune matches')).toBeTruthy();
    expect(screen.queryByText('The Banshee')).toBeNull();
    expect(screen.queryByText('Sligo Creek')).toBeNull();
  });

  it('el filtro de ritmo acota sin teclear nada, y las aparcadas entran', async () => {
    renderSearch();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    pickRhythm('reel');

    // Alfabético por título mostrado, no por peldaño ni por llegada.
    await waitFor(() =>
      expect(cardTitles()).toEqual(['Cooley’s Reel', 'Morning Dew', 'Sligo Creek'])
    );
    expect(screen.getByText('3 tunes match')).toBeTruthy();
    expect(screen.queryByText('The Banshee')).toBeNull();
  });

  it('el texto y el ritmo se suman: sin coincidencias lo dice', async () => {
    renderSearch();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    typeTerm('banshee');
    expect(cardTitles()).toEqual(['The Banshee']);

    pickRhythm('reel');

    await waitFor(() => expect(screen.getByText('No tune matches that search.')).toBeTruthy());
    expect(cards()).toHaveLength(0);
  });

  it('la carta enseña el peldaño, y en las aparcadas dice «Shelved»', async () => {
    renderSearch();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    typeTerm('e');

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    const learning = cardFor('Morning Dew').querySelector('.tune-meta')!.textContent!;
    expect(learning).toContain('Learning');
    // `rhythm · key · level`, el mismo orden de la línea de la carta.
    expect(learning).toContain('reel');
    expect(learning).toContain('D');

    const shelved = cardFor('Sligo Creek').querySelector('.tune-meta')!.textContent!;
    expect(shelved).toContain('Shelved');
    expect(shelved).not.toContain('Solo-ready');
  });
});
