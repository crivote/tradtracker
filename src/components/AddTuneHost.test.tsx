// @vitest-environment jsdom
/**
 * El cajón del alta, montado una sola vez en el armazón (#65): el botón del menú
 * principal abre este host y el cajón se queda aquí.
 *
 * Las pruebas del camino entero —abrir, elegir nivel, buscar, añadir— vivían en
 * `Repertoire.test.tsx` cuando el cajón era de la home. Ya no lo es: ahora pide
 * su contexto al abrirse (`fetchAddTuneContext`) y publica el cambio para que la
 * pantalla de debajo recargue. Eso es lo que se prueba aquí, además de los
 * gestos que el cajón ya tenía.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    addCatalogueTune: vi.fn(),
    fetchAddTuneContext: vi.fn(),
  };
});

vi.mock('../lib/catalogue-db', () => ({
  preloadCatalogue: vi.fn(async () => undefined),
  searchCatalogue: vi.fn(async () => []),
  getCatalogueStats: vi.fn(async () => ({ tunes: 0 })),
  lookupCatalogueMeta: vi.fn(async () => new Map()),
}));

import { addCatalogueTune, fetchAddTuneContext } from '../lib/repertoire';
import { lookupCatalogueMeta, searchCatalogue } from '../lib/catalogue-db';
import { slotsFor } from '../lib/repertoire-model';
import { closeAddTune, openAddTune, REPERTOIRE_CHANGED } from '../lib/add-tune';
import AddTuneHost from './AddTuneHost';

const mockedAddCatalogueTune = vi.mocked(addCatalogueTune);
const mockedContext = vi.mocked(fetchAddTuneContext);
const mockedSearchCatalogue = vi.mocked(searchCatalogue);
const mockedLookupMeta = vi.mocked(lookupCatalogueMeta);

/**
 * El host solo, sin la pantalla: el cajón no depende de la ruta, y montar la
 * home entera aquí escondería justo lo que el corte viene a demostrar. El
 * `MemoryRouter` sí hace falta: el cajón enlaza a la pantalla del peldaño.
 */
function renderHost() {
  const history = createMemoryHistory();
  history.set({ value: '/' });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/" component={AddTuneHost} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  // El estado del cajón es un módulo: si una prueba lo deja abierto, la
  // siguiente arranca con el diálogo puesto.
  closeAddTune();
  mockedAddCatalogueTune.mockReset();
  mockedAddCatalogueTune.mockResolvedValue({ status: 'to_learn' } as any);
  mockedContext.mockReset();
  mockedContext.mockResolvedValue({ refs: new Set<string>(), slots: slotsFor(0, 6) });
  mockedSearchCatalogue.mockReset();
  mockedSearchCatalogue.mockResolvedValue([]);
  mockedLookupMeta.mockReset();
  mockedLookupMeta.mockResolvedValue(new Map());
  localStorage.removeItem('tt-practice-prefs');
});

afterEach(() => {
  closeAddTune();
  cleanup();
});

describe('cajón del alta montado en el armazón (#65)', () => {
  it('el botón del menú abre el cajón con el contexto del repertorio', async () => {
    mockedContext.mockResolvedValue({ refs: new Set(['55']), slots: slotsFor(2, 6) });
    renderHost();

    openAddTune();
    const drawer = await screen.findByRole('dialog', { name: 'Add tunes' });
    expect(drawer).toBeTruthy();
    // El contexto se pide al abrir, no al montar: el cajón no existía antes.
    expect(mockedContext).toHaveBeenCalledTimes(1);
  });

  it('el nivel elegido y el día aprendido viajan al alta', async () => {
    mockedSearchCatalogue.mockResolvedValue([
      { tuneId: 1234, name: 'Christmas Eve', type: 'reel', meter: null, popularity: 3, aliases: null },
    ]);
    mockedLookupMeta.mockResolvedValue(new Map([[1234, { meter: '4/4', composer: 'Tommy Coen' }]]));

    renderHost();
    openAddTune();

    const drawer = await screen.findByRole('dialog', { name: 'Add tunes' });

    // El peldaño se elige aquí, con su definición escrita al lado.
    const levelPick = within(drawer).getByLabelText('Add as') as HTMLSelectElement;
    expect(levelPick.value).toBe('to_learn');
    fireEvent.change(levelPick, { target: { value: 'learning' } });
    expect(drawer.textContent).toContain('Know the parts, but can’t get through it end to end.');

    fireEvent.input(within(drawer).getByLabelText('Search the tune catalogue'), {
      target: { value: 'christmas' },
    });
    fireEvent.change(within(drawer).getByLabelText('Learned around (optional)'), {
      target: { value: '2019-04-12' },
    });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockedAddCatalogueTune).toHaveBeenCalled());
    expect(mockedAddCatalogueTune).toHaveBeenCalledWith(
      {
        tuneId: 1234,
        name: 'Christmas Eve',
        rhythm: 'reel',
        meter: null,
        composer: 'Tommy Coen',
      },
      'learning',
      '2019-04-12'
    );

    await waitFor(() => expect(within(drawer).getByText(/added as Learning/)).toBeTruthy());
    expect(within(drawer).getByRole('link', { name: /See learning/ }).getAttribute('href')).toBe(
      '/learning'
    );
  });

  it('sin tocar el nivel, el alta sigue cayendo en el backlog', async () => {
    mockedSearchCatalogue.mockResolvedValue([
      { tuneId: 7, name: 'The Butterfly', type: 'jig', meter: '6/8', popularity: 9, aliases: null },
    ]);

    renderHost();
    openAddTune();

    const drawer = await screen.findByRole('dialog', { name: 'Add tunes' });
    fireEvent.input(within(drawer).getByLabelText('Search the tune catalogue'), {
      target: { value: 'butterfly' },
    });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(mockedAddCatalogueTune).toHaveBeenCalledWith(
        expect.objectContaining({ tuneId: 7 }),
        'to_learn',
        ''
      )
    );
  });

  it('avisa del tope del banco con la ocupación que trae el contexto', async () => {
    mockedContext.mockResolvedValue({ refs: new Set<string>(), slots: slotsFor(8, 6) });

    renderHost();
    openAddTune();

    const drawer = await screen.findByRole('dialog', { name: 'Add tunes' });
    fireEvent.change(within(drawer).getByLabelText('Add as'), { target: { value: 'learning' } });

    await waitFor(() => expect(drawer.textContent).toContain('8 of 6 slots'));
    expect(drawer.textContent).toContain('over by 2');
  });

  it('al añadir publica el cambio para que la pantalla de debajo recargue', async () => {
    const onChange = vi.fn();
    window.addEventListener(REPERTOIRE_CHANGED, onChange);
    mockedSearchCatalogue.mockResolvedValue([
      { tuneId: 9, name: 'The Kesh', type: 'jig', meter: '6/8', popularity: 9, aliases: null },
    ]);

    renderHost();
    openAddTune();

    const drawer = await screen.findByRole('dialog', { name: 'Add tunes' });
    fireEvent.input(within(drawer).getByLabelText('Search the tune catalogue'), {
      target: { value: 'kesh' },
    });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    window.removeEventListener(REPERTOIRE_CHANGED, onChange);
  });

  it('Escape y el botón de cerrar lo cierran', async () => {
    renderHost();
    openAddTune();
    await screen.findByRole('dialog', { name: 'Add tunes' });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    openAddTune();
    const drawer2 = await screen.findByRole('dialog', { name: 'Add tunes' });

    // El cajón lleva su ✕ en la cabecera y el panel del import su «Close» al
    // pie: se pulsa el de la cabecera, que es el de la superficie.
    const head = drawer2.querySelector('.drawer-head') as HTMLElement;
    fireEvent.click(within(head).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
