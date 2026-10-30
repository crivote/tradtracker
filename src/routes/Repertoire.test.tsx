// @vitest-environment jsdom
/**
 * La home nunca se había ejecutado: #29 la verificó con tests del modelo puro y
 * mediciones en el navegador. El corte de #11 le añade dos reglas que solo se
 * ven montando el componente —las aparcadas fuera de las bandas y el cajón del
 * final— y una que ya existía y conviene no romper, el aislamiento por `?band=`.
 *
 * El acceso a Supabase y el catálogo van simulados: lo que se prueba aquí es el
 * cableado de la vista, no el adaptador (ese se ejercita contra la base real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    fetchRepertoire: vi.fn(),
    removeFromRepertoire: vi.fn(),
    addCatalogueTune: vi.fn(),
  };
});

vi.mock('../lib/catalogue-db', () => ({
  preloadCatalogue: vi.fn(async () => undefined),
  searchCatalogue: vi.fn(async () => []),
  getCatalogueStats: vi.fn(async () => ({ tunes: 0 })),
}));

vi.mock('../lib/practice', () => ({
  logPractice: vi.fn(async () => undefined),
}));

import { fetchRepertoire } from '../lib/repertoire';
import Repertoire from './Repertoire';

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
      key: null,
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
 * Tres tunes en rotación (una por banda relevante) y una cuarta aparcada en
 * `playing_along`: la aparcada es la que no debe pisar su banda ni la urgencia.
 */
const ROWS = [
  row({ id: 'row-learn', status: 'to_learn', tune: { ...row().tune, id: 't1', name: 'Morning Dew' } }),
  row({ id: 'row-learning', status: 'learning', tune: { ...row().tune, id: 't2', name: 'Cooley’s Reel' } }),
  row({ id: 'row-solo', status: 'solo_ready', tune: { ...row().tune, id: 't3', name: 'Drowsy Maggie' } }),
  row({
    id: 'row-shelved',
    status: 'playing_along',
    shelved: true,
    tune: { ...row().tune, id: 't4', name: 'Sligo Creek' },
  }),
];

function renderHome() {
  const history = createMemoryHistory();
  history.set({ value: '/' });
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route path="/" component={Repertoire} />
    </MemoryRouter>
  ));
  return { history, ...view };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(ROWS as any);
});

afterEach(() => cleanup());

describe('home del repertorio con peldaños y cajón (#11)', () => {
  it('la cabecera cuadra: las aparcadas se nombran aparte de las cuatro bandas', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Repertoire')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 shelved/)).toBeTruthy());

    const sub = document.querySelector('.page-head .sub')!.textContent!.replace(/\s+/g, ' ');
    // El total es el repertorio entero y las partes lo suman: 3 en bandas + 1 en el cajón.
    expect(sub).toContain('4 tunes');
    expect(sub).toContain('1 to learn');
    expect(sub).toContain('1 learning');
    expect(sub).toContain('0 playing along');
    expect(sub).toContain('1 solo-ready');
    expect(sub).toContain('1 shelved');
  });

  it('la aparcada no pisa su banda y espera en el cajón, cerrado hasta que se abre', async () => {
    renderHome();

    const playingAlong = await waitFor(() => {
      const section = document.querySelector('[data-band="playing_along"]');
      expect(section).toBeTruthy();
      return section as HTMLElement;
    });

    // Su banda se queda vacía: la aparcada no está en rotación.
    expect(playingAlong.textContent).toContain('Nothing at this level yet.');
    expect(playingAlong.textContent).not.toContain('Sligo Creek');

    // Y no aparece en ninguna otra banda.
    expect(screen.queryByText('Sligo Creek')).toBeNull();

    // El cajón anuncia su recuento y arranca cerrado.
    const shelf = document.querySelector('.band--shelved') as HTMLElement;
    expect(shelf).toBeTruthy();
    expect(shelf.textContent).toContain('Shelved');
    expect(shelf.textContent).toContain('1 tune');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    await waitFor(() => expect(screen.getByText('Sligo Creek')).toBeTruthy());
  });

  it('el título de la banda aísla ese peldaño y el cajón se retira con él', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Morning Dew')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Show only Learning' }));

    await waitFor(() => expect(screen.queryByText('Morning Dew')).toBeNull());
    expect(screen.getByText('Cooley’s Reel')).toBeTruthy();
    // Con una banda aislada la pantalla es esa banda: el cajón no se pinta.
    expect(document.querySelector('.band--shelved')).toBeNull();
    // Y la barra dice qué se está viendo, con la vuelta disponible.
    expect(screen.getByText(/Showing/)).toBeTruthy();
    // Hay dos «Back to all» (la barra y el pie de la banda): basta con que exista.
    expect(screen.getAllByRole('button', { name: /Back to all/ }).length).toBeGreaterThan(0);
  });
});
