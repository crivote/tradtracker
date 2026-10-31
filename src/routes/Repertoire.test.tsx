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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    fetchRepertoire: vi.fn(),
    addCatalogueTune: vi.fn(),
    saveFavorite: vi.fn(async () => undefined),
    saveStatus: vi.fn(async () => undefined),
  };
});

vi.mock('../lib/catalogue-db', () => ({
  preloadCatalogue: vi.fn(async () => undefined),
  searchCatalogue: vi.fn(async () => []),
  getCatalogueStats: vi.fn(async () => ({ tunes: 0 })),
  lookupCatalogueMeta: vi.fn(async () => new Map()),
}));

vi.mock('../lib/practice', () => ({
  logPractice: vi.fn(async () => undefined),
}));

import {
  VIEW_MODE_KEY,
  addCatalogueTune,
  fetchRepertoire,
  saveFavorite,
  saveStatus,
} from '../lib/repertoire';
import { lookupCatalogueMeta, searchCatalogue } from '../lib/catalogue-db';
import Repertoire from './Repertoire';

const mockedFetch = vi.mocked(fetchRepertoire);
const mockedSaveFavorite = vi.mocked(saveFavorite);
const mockedSaveStatus = vi.mocked(saveStatus);
const mockedAddCatalogueTune = vi.mocked(addCatalogueTune);
const mockedSearchCatalogue = vi.mocked(searchCatalogue);
const mockedLookupMeta = vi.mocked(lookupCatalogueMeta);

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

/**
 * Filas de la tabla (#42): tres tunes con historial distinto para que urgencia,
 * ensayos y alfabético den tres órdenes distintos y ninguna prueba pase por
 * casualidad. «Cooley’s Reel» trae el autor en blanco —el caso normal del
 * repertorio—, así que su subtexto no lo pinta.
 */
const TABLE_ROWS = [
  row({
    id: 'row-cameron',
    status: 'learning',
    practice_count: 9,
    avg_quality: 4.2,
    last_practiced_at: '2026-10-20T10:00:00Z',
    added_at: '2026-03-01T10:00:00Z',
    tune: {
      ...row().tune,
      id: 't-cameron',
      name: 'The Cameron Highlanders',
      rhythm: 'march',
      composer: 'James Scott Skinner',
    },
  }),
  row({
    id: 'row-drowsy',
    status: 'to_learn',
    practice_count: 0,
    avg_quality: null,
    last_practiced_at: null,
    added_at: '2026-09-01T10:00:00Z',
    tune: { ...row().tune, id: 't-drowsy', name: 'Drowsy Maggie', rhythm: 'reel' },
  }),
  row({
    id: 'row-cooley',
    status: 'solo_ready',
    practice_count: 3,
    avg_quality: 3.5,
    last_practiced_at: '2025-12-01T10:00:00Z',
    added_at: '2026-01-01T10:00:00Z',
    tune: { ...row().tune, id: 't-cooley', name: 'Cooley’s Reel', rhythm: 'reel', composer: '   ' },
  }),
];

function renderHome(path = '/') {
  const history = createMemoryHistory();
  history.set({ value: path });
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route path="/" component={Repertoire} />
    </MemoryRouter>
  ));
  return { history, ...view };
}

/** La tabla es una preferencia de pestaña: se enciende por el almacén, no a clics. */
function renderTable() {
  sessionStorage.setItem(VIEW_MODE_KEY, 'table');
  return renderHome();
}

/** Los títulos de las filas, en el orden en que están pintadas. */
function rowTitles(): string[] {
  return Array.from(document.querySelectorAll('.table-wrap .row-title a')).map(
    (node) => node.textContent ?? ''
  );
}

/** La fila de un título: las consultas por rol no pueden acotar al `<tr>` solas. */
function rowOf(title: string): HTMLElement {
  const link = Array.from(document.querySelectorAll('.table-wrap .row-title a')).find(
    (node) => node.textContent === title
  );
  if (!link) throw new Error(`No row titled ${title}`);
  return link.closest('tr') as HTMLElement;
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(ROWS as any);
  mockedSaveFavorite.mockReset();
  mockedSaveFavorite.mockResolvedValue(undefined);
  mockedSaveStatus.mockReset();
  mockedSaveStatus.mockResolvedValue(undefined);
  // La preferencia de vista vive en `sessionStorage`: sin limpiar, la prueba que
  // abre la lista dejaría «table» puesto para la siguiente.
  sessionStorage.clear();
});

afterEach(() => cleanup());

describe('home del repertorio con peldaños (#11, #29)', () => {
  it('la cabecera cuadra: las aparcadas se nombran aparte de las cuatro bandas', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Repertoire')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 shelved/)).toBeTruthy());

    const sub = document.querySelector('.page-head .sub')!.textContent!.replace(/\s+/g, ' ');
    // El total es el repertorio entero y las partes lo suman: 3 en bandas + 1 aparcada.
    expect(sub).toContain('4 tunes');
    expect(sub).toContain('1 to learn');
    expect(sub).toContain('1 learning');
    expect(sub).toContain('0 playing along');
    expect(sub).toContain('1 solo-ready');
    expect(sub).toContain('1 shelved');
  });

  it('la aparcada no pisa su banda y en la home solo queda su recuento', async () => {
    renderHome();

    const playingAlong = await waitFor(() => {
      const section = document.querySelector('[data-band="playing_along"]');
      expect(section).toBeTruthy();
      return section as HTMLElement;
    });

    // Su banda se queda vacía: la aparcada no está en rotación.
    expect(playingAlong.textContent).toContain('Nothing at this level yet.');
    expect(playingAlong.textContent).not.toContain('Sligo Creek');

    // Y no aparece en ninguna otra banda ni en un cajón: en la home no se pinta.
    expect(screen.queryByText('Sligo Creek')).toBeNull();
    expect(document.querySelector('.band--shelved')).toBeNull();

    // El recuento de la cabecera es la puerta: lleva a su listado.
    fireEvent.click(screen.getByRole('button', { name: /1 shelved/ }));

    await waitFor(() => expect(screen.getByText('Sligo Creek')).toBeTruthy());
    // La lista dice de qué es y deja volver.
    expect(screen.getByText(/Showing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to all/ })).toBeTruthy();
  });

  it('todas las cartas de la home son iguales: ni una sola en miniatura', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Morning Dew')).toBeTruthy());
    const cards = document.querySelectorAll('.repertoire-home .card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.classList.contains('tile')).toBe(false);
      // El medidor de calidad no se cae en ninguna banda.
      expect(card.querySelector('.quality')).toBeTruthy();
    }
  });

  it('el título de la banda la aísla en la rejilla y ofrece su listado', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Morning Dew')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Show only Learning' }));

    await waitFor(() => expect(screen.queryByText('Morning Dew')).toBeNull());
    expect(screen.getByText('Cooley’s Reel')).toBeTruthy();
    // La barra dice qué se está viendo, con la vuelta disponible.
    expect(screen.getByText(/Showing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to all/ })).toBeTruthy();

    // El listado completo de un peldaño es una lista: la puerta está en la banda.
    fireEvent.click(screen.getByRole('button', { name: /See all 1 as list/ }));

    await waitFor(() => {
      expect(document.querySelector('.repertoire-home table')).toBeTruthy();
    });
    expect(screen.getByText('Cooley’s Reel')).toBeTruthy();
    expect(screen.queryByText('Morning Dew')).toBeNull();
  });

  it('la carta de la home no enseña el peldaño: eso es de la búsqueda (#9)', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Morning Dew')).toBeTruthy());

    const metas = Array.from(
      document.querySelectorAll<HTMLElement>('.repertoire-home .card .tune-meta')
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) {
      expect(meta.textContent).not.toMatch(/To learn|Learning|Playing along|Solo-ready|Shelved/);
    }

    // Y la home ya no tiene campo de búsqueda: su hueco es la puerta a /search.
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: /Search tunes/ })).toBeTruthy();
  });
});

/**
 * La tabla del listado (#42, boceto 014-b). Estas pruebas montan la vista en
 * modo tabla y miran el DOM: el orden de las filas, las cabeceras ordenables, el
 * subtexto de los invariantes, el icono del peldaño, el menú de dos niveles, el
 * corazón y la ausencia de «Remove».
 */
describe('tabla del listado (#42)', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(TABLE_ROWS as any);
  });

  async function ready() {
    await waitFor(() => expect(rowTitles().length).toBe(TABLE_ROWS.length));
  }

  it('ordena por urgencia por defecto: la nunca ensayada primero y después la más abandonada', async () => {
    renderTable();
    await ready();

    // «Drowsy Maggie» no se ha ensayado nunca; de las otras dos, la de
    // diciembre lleva más tiempo sin tocarse que la de octubre.
    expect(rowTitles()).toEqual([
      'Drowsy Maggie',
      'Cooley’s Reel',
      'The Cameron Highlanders',
    ]);

    // Y la cabecera de Last played es la que lo dice, con la flecha puesta.
    const sorted = document.querySelector('.table-wrap th[aria-sort]')!;
    expect(sorted.textContent).toContain('Last played');
    expect(sorted.getAttribute('aria-sort')).toBe('descending');
  });

  it('la cabecera Practices ordena por ensayos de más a menos y deja el th con aria-sort y su flecha', async () => {
    renderTable();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Practices' }));

    await waitFor(() =>
      expect(rowTitles()).toEqual([
        'The Cameron Highlanders',
        'Cooley’s Reel',
        'Drowsy Maggie',
      ])
    );

    const th = document.querySelector('.table-wrap th[aria-sort]')!;
    expect(th.textContent).toContain('Practices');
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(th.querySelector('.arrow')!.textContent).toBe('▼');
    // Una sola columna ordenada: `aria-sort` no se queda pegado a la anterior.
    expect(document.querySelectorAll('.table-wrap th[aria-sort]').length).toBe(1);
  });

  it('el segundo clic invierte la columna y el clic en Tune ordena alfabético ascendente', async () => {
    renderTable();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Practices' }));
    await waitFor(() => expect(document.querySelector('.table-wrap th[aria-sort]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Practices' }));

    await waitFor(() =>
      expect(rowTitles()).toEqual([
        'Drowsy Maggie',
        'Cooley’s Reel',
        'The Cameron Highlanders',
      ])
    );
    const inverted = document.querySelector('.table-wrap th[aria-sort]')!;
    expect(inverted.textContent).toContain('Practices');
    expect(inverted.getAttribute('aria-sort')).toBe('ascending');
    expect(inverted.querySelector('.arrow')!.textContent).toBe('▲');

    fireEvent.click(screen.getByRole('button', { name: 'Tune' }));

    // Alfabético ascendente: «Cooley» va antes que «Drowsy», que es justo lo
    // que el orden por ensayos ascendente NO daba.
    await waitFor(() =>
      expect(rowTitles()).toEqual([
        'Cooley’s Reel',
        'Drowsy Maggie',
        'The Cameron Highlanders',
      ])
    );
    const byTitle = document.querySelector('.table-wrap th[aria-sort]')!;
    expect(byTitle.textContent).toContain('Tune');
    expect(byTitle.getAttribute('aria-sort')).toBe('ascending');
  });

  it('bajo el título van los invariantes, con el autor cuando lo hay y sin él cuando falta', async () => {
    renderTable();
    await ready();

    const invariants = (title: string) =>
      rowOf(title)
        .querySelector('.row-invariants')!
        .textContent!.replace(/\s*·\s*/g, '·')
        .trim();

    // tipo · compás · autor, y el autor en cursiva.
    expect(invariants('The Cameron Highlanders')).toBe('march·4/4·James Scott Skinner');
    expect(rowOf('The Cameron Highlanders').querySelector('.row-invariants i')!.textContent).toBe(
      'James Scott Skinner'
    );

    // Sin autor —el caso normal del repertorio— la parte se omite: ni cursiva,
    // ni un separador de más, ni un guion de relleno.
    expect(invariants('Cooley’s Reel')).toBe('reel·4/4');
    expect(rowOf('Cooley’s Reel').querySelector('.row-invariants i')).toBeNull();
    expect(rowOf('Cooley’s Reel').querySelector('.row-invariants')!.textContent).not.toContain('—');
  });

  it('el peldaño se pinta como cuatro barras con su aria-label', async () => {
    renderTable();
    await ready();

    const icon = rowOf('Cooley’s Reel').querySelector('.rung')!;
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe(
      'Level: Solo-ready — If someone asks for a tune, this is one you’d give them.'
    );
    expect(icon.querySelectorAll('span').length).toBe(4);
    expect(icon.querySelectorAll('span.on').length).toBe(4);

    // Un peldaño bajo enciende solo la primera: las barras dicen la altura.
    expect(rowOf('Drowsy Maggie').querySelectorAll('.rung span.on').length).toBe(1);
    expect(rowOf('The Cameron Highlanders').querySelectorAll('.rung span.on').length).toBe(2);
  });

  it('el menú abre el submenú del peldaño; elegir guarda y mueve icono, title y aria-label a la vez', async () => {
    renderTable();
    await ready();

    const row = rowOf('The Cameron Highlanders');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Actions for The Cameron Highlanders' })
    );

    // Segundo nivel: el menú principal dice el peldaño actual y el submenú trae
    // las cuatro opciones, con la actual marcada.
    fireEvent.click(within(row).getByRole('button', { name: /^Level/ }));

    const options = within(row).getAllByRole('menuitemradio');
    expect(options.length).toBe(4);
    for (const option of options) {
      expect(option.textContent).toMatch(/to learn|know the parts|someone else leads|asks for a tune/i);
    }
    expect(
      within(row).getByRole('menuitemradio', { name: /^Learning/ }).getAttribute('aria-checked')
    ).toBe('true');

    fireEvent.click(within(row).getByRole('menuitemradio', { name: /^Solo-ready/ }));

    await waitFor(() =>
      expect(mockedSaveStatus).toHaveBeenCalledWith('row-cameron', 'solo_ready')
    );

    // El icono cambia de barras y su nombre accesible con él: tocar solo el
    // `title` dejaría el nombre viejo (trampa medida del boceto).
    const updated = rowOf('The Cameron Highlanders').querySelector('.rung')!;
    const described = 'Solo-ready — If someone asks for a tune, this is one you’d give them.';
    expect(updated.getAttribute('aria-label')).toBe(`Level: ${described}`);
    expect(updated.getAttribute('title')).toBe(described);
    expect(updated.querySelectorAll('span.on').length).toBe(4);
  });

  it('un solo menú abierto a la vez, y Escape cierra antes el submenú que el menú', async () => {
    renderTable();
    await ready();

    const cameron = rowOf('The Cameron Highlanders');
    fireEvent.click(
      within(cameron).getByRole('button', { name: 'Actions for The Cameron Highlanders' })
    );
    expect(cameron.querySelector('.menu')!.classList.contains('open')).toBe(true);

    // Abrir otro menú cierra el primero sin que nadie lleve la cuenta.
    const cooley = rowOf('Cooley’s Reel');
    fireEvent.click(within(cooley).getByRole('button', { name: 'Actions for Cooley’s Reel' }));
    expect(cameron.querySelector('.menu')!.classList.contains('open')).toBe(false);
    expect(cooley.querySelector('.menu')!.classList.contains('open')).toBe(true);

    // Con el submenú desplegado, el primer Escape lo cierra y deja el menú.
    fireEvent.click(within(cooley).getByRole('button', { name: /^Level/ }));
    expect(cooley.querySelector('.submenu')!.hasAttribute('hidden')).toBe(false);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cooley.querySelector('.submenu')!.hasAttribute('hidden')).toBe(true);
    expect(cooley.querySelector('.menu')!.classList.contains('open')).toBe(true);

    // El segundo Escape cierra el menú.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cooley.querySelector('.menu')!.classList.contains('open')).toBe(false);
  });

  it('el corazón guarda el valor contrario y alterna aria-pressed', async () => {
    renderTable();
    await ready();

    const heart = within(rowOf('Drowsy Maggie')).getByRole('button', {
      name: 'Favourite: Drowsy Maggie',
    });
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    expect(heart.textContent).toBe('♡');

    fireEvent.click(heart);

    await waitFor(() => expect(mockedSaveFavorite).toHaveBeenCalledWith('row-drowsy', true));

    const after = within(rowOf('Drowsy Maggie')).getByRole('button', {
      name: 'Favourite: Drowsy Maggie',
    });
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.textContent).toBe('♥');
  });

  it('no hay ningún «Remove» en la tabla: el borrado vive en la ficha (#45)', async () => {
    renderTable();
    await ready();

    const table = document.querySelector('.table-wrap')!;
    expect(table.textContent).not.toMatch(/Remove/i);
    expect(table.querySelector('.remove')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('«Back to all» desde el cajón vuelve a la home, no a la lista completa', async () => {
    // El cajón tiene su propia fila: las de la tabla no están aparcadas.
    mockedFetch.mockResolvedValue(ROWS as any);
    sessionStorage.setItem(VIEW_MODE_KEY, 'table');
    const { history } = renderHome('/?band=shelved');

    await waitFor(() => expect(screen.getByText('Sligo Creek')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Back to all/ }));

    await waitFor(() => expect(history.get()).toBe('/'));
    // Y lo que se ve es la home —las bandas—, no la lista de todo el repertorio.
    await waitFor(() => expect(document.querySelector('.band')).toBeTruthy());
    expect(document.querySelector('.repertoire-home table')).toBeNull();
  });

  /**
   * El hueco que dejó #44: el buscador del catálogo no devuelve el autor, así
   * que el alta tiene que recogerlo del catálogo antes de crear el tune, o cada
   * fila nueva nace sin autor y el subtexto que esta tabla estrena queda cojo.
   */
  it('el alta desde la búsqueda arrastra el autor hasta ensureTune', async () => {
    mockedFetch.mockResolvedValue(ROWS as any);
    mockedSearchCatalogue.mockResolvedValue([
      { tuneId: 1234, name: 'Christmas Eve', type: 'reel', meter: null, popularity: 3, aliases: null },
    ]);
    mockedLookupMeta.mockResolvedValue(new Map([[1234, { meter: '4/4', composer: 'Tommy Coen' }]]));

    renderHome();
    await waitFor(() => expect(screen.getByText('Morning Dew')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Add a tune' }));
    fireEvent.input(screen.getByLabelText('Search the tune catalogue'), {
      target: { value: 'christmas' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockedAddCatalogueTune).toHaveBeenCalled());
    expect(mockedAddCatalogueTune).toHaveBeenCalledWith({
      tuneId: 1234,
      name: 'Christmas Eve',
      rhythm: 'reel',
      meter: null,
      composer: 'Tommy Coen',
    });
  });
});
