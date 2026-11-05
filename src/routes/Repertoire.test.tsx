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

vi.mock('../lib/tags-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tags-db')>();
  return {
    ...actual,
    fetchVocabulary: vi.fn(),
    loadVocabulary: vi.fn(),
    fetchTuneTags: vi.fn(),
    addTuneTags: vi.fn(),
    removeTuneTag: vi.fn(),
  };
});

import {
  VIEW_MODE_KEY,
  addCatalogueTune,
  fetchRepertoire,
  saveFavorite,
  saveStatus,
} from '../lib/repertoire';
import { lookupCatalogueMeta, searchCatalogue } from '../lib/catalogue-db';
import {
  addTuneTags,
  fetchTuneTags,
  fetchVocabulary,
  loadVocabulary,
  removeTuneTag,
} from '../lib/tags-db';
import { readPrefs } from '../lib/practice-storage';
import Repertoire from './Repertoire';

const mockedFetch = vi.mocked(fetchRepertoire);
const mockedSaveFavorite = vi.mocked(saveFavorite);
const mockedSaveStatus = vi.mocked(saveStatus);
const mockedAddCatalogueTune = vi.mocked(addCatalogueTune);
const mockedSearchCatalogue = vi.mocked(searchCatalogue);
const mockedLookupMeta = vi.mocked(lookupCatalogueMeta);
const mockedLoadVocabulary = vi.mocked(loadVocabulary);
const mockedFetchVocabulary = vi.mocked(fetchVocabulary);
const mockedFetchTuneTags = vi.mocked(fetchTuneTags);
const mockedAddTuneTags = vi.mocked(addTuneTags);
const mockedRemoveTuneTag = vi.mocked(removeTuneTag);

/**
 * Vocabulario mínimo para el panel de etiquetas (#48): las tres facetas y
 * `Donegal` colgando de `Ireland`, que es lo que hace visible la jerarquía y
 * permite comprobar que la casilla que se marca es la que viaja al adaptador.
 */
const VOCABULARY = {
  facets: [
    { id: 'tradition', label: 'Tradition', sort: 1 },
    { id: 'technique', label: 'Technique', sort: 2 },
    { id: 'mood', label: 'Mood', sort: 3 },
  ],
  tags: [
    { id: 1, facet: 'tradition', value: 'ireland', label: 'Ireland', parent: null, sort: 1 },
    { id: 2, facet: 'tradition', value: 'scotland', label: 'Scotland', parent: null, sort: 2 },
    { id: 3, facet: 'tradition', value: 'donegal', label: 'Donegal', parent: 1, sort: 11 },
    { id: 10, facet: 'technique', value: 'rolls', label: 'Rolls', parent: null, sort: 6 },
    { id: 20, facet: 'mood', value: 'melancholy', label: 'Melancholy', parent: null, sort: 1 },
  ],
};

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
  // Etiquetas (#48): el vocabulario llega resuelto y las escrituras no cruzan.
  mockedLoadVocabulary.mockReset();
  mockedLoadVocabulary.mockResolvedValue(VOCABULARY as any);
  mockedFetchVocabulary.mockReset();
  mockedFetchVocabulary.mockResolvedValue(VOCABULARY as any);
  mockedFetchTuneTags.mockReset();
  mockedFetchTuneTags.mockResolvedValue([]);
  mockedAddTuneTags.mockReset();
  mockedAddTuneTags.mockResolvedValue(2);
  mockedRemoveTuneTag.mockReset();
  mockedRemoveTuneTag.mockResolvedValue(undefined);
  // La preferencia de vista vive en `sessionStorage`: sin limpiar, la prueba que
  // abre la lista dejaría «table» puesto para la siguiente.
  sessionStorage.clear();
  // El tope del taller vive en `localStorage` (#52): una prueba que lo sube
  // dejaría el valor puesto para la siguiente, que espera el de fábrica.
  localStorage.removeItem('tt-practice-prefs');
});

afterEach(() => cleanup());

describe('home del repertorio con peldaños (#11, #29)', () => {
  it('la cabecera cuadra: las aparcadas se nombran aparte de las cinco bandas', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Repertoire')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 shelved/)).toBeTruthy());

    const sub = document.querySelector('.page-head .sub')!.textContent!.replace(/\s+/g, ' ');
    // El total es el repertorio entero y las partes lo suman: 3 en bandas + 1 aparcada.
    expect(sub).toContain('4 tunes');
    expect(sub).toContain('1 to learn');
    expect(sub).toContain('1 learning');
    expect(sub).toContain('0 shaky');
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

    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());
    const cards = document.querySelectorAll('.repertoire-home .card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.classList.contains('tile')).toBe(false);
      // El medidor de calidad no se cae en ninguna banda.
      expect(card.querySelector('.quality')).toBeTruthy();
    }
  });

  it('la home pinta las cinco bandas de la escalera y ninguna de backlog (#50)', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());
    const bands = Array.from(document.querySelectorAll('.repertoire-home .band')).map(
      (node) => node.getAttribute('data-band')
    );
    expect(bands).toEqual(['learning', 'shaky', 'playing_along', 'solo_ready', 'mastered']);
    // El backlog no es una banda: su pieza no se pinta en la home.
    expect(document.querySelector('[data-band="to_learn"]')).toBeNull();
    expect(screen.queryByText('Morning Dew')).toBeNull();
  });

  it('el tope son tres filas: 12 cartas por banda, y el resto va al listado (#46)', async () => {
    // 14 en el mismo peldaño con la rejilla de cuatro columnas: caben 12 (3 × 4).
    // Se prueban sobre `solo_ready`: el taller (`learning`) ya no es una rejilla (#52).
    const bulk = Array.from({ length: 14 }, (_, index) =>
      row({
        id: `bulk-${index}`,
        status: 'solo_ready',
        tune: { ...row().tune, id: `t-bulk-${index}`, name: `Bulk Tune ${index}` },
      })
    );
    mockedFetch.mockResolvedValue(bulk as any);

    // jsdom no resuelve `grid-template-columns`, así que el tope se mediría sobre
    // una rejilla de una columna. Se dobla **solo** esa propiedad con el valor
    // calculado de un navegador —cuatro pistas— y se delega el resto al estilo
    // real: devolver un objeto pelado rompe el cálculo de nombres accesibles.
    const realStyle = window.getComputedStyle.bind(window);
    const computed = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(((element: Element, pseudo?: string | null) => {
        const style = realStyle(element, pseudo ?? undefined);
        return new Proxy(style, {
          get(target, prop, receiver) {
            if (prop === 'gridTemplateColumns' && element.classList.contains('grid-4')) {
              return '282px 282px 282px 282px';
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }) as typeof window.getComputedStyle);

    try {
      renderHome();

      await waitFor(() => expect(screen.getByText('Bulk Tune 0')).toBeTruthy());
      const band = document.querySelector('[data-band="solo_ready"]') as HTMLElement;
      expect(band.querySelectorAll('.card').length).toBe(12);
      // Dos de las catorce se quedan fuera (el orden dentro de la banda es por
      // título, así que no se afirma *cuáles*: solo que son doce de catorce).
      const painted = bulk.filter((_, index) => screen.queryByText(`Bulk Tune ${index}`) !== null);
      expect(painted.length).toBe(12);
      // Y la banda avisa de que hay más, con la puerta a la lista completa.
      expect(screen.getByRole('button', { name: /See all 14 as list/ })).toBeTruthy();
    } finally {
      computed.mockRestore();
    }
  });

  it('el título de la banda la aísla en la rejilla y ofrece su listado', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Show only Solo-ready' }));

    await waitFor(() => expect(screen.queryByText('Cooley’s Reel')).toBeNull());
    expect(screen.getByText('Drowsy Maggie')).toBeTruthy();
    // La barra dice qué se está viendo, con la vuelta disponible.
    expect(screen.getByText(/Showing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to all/ })).toBeTruthy();

    // El listado completo de un peldaño es una lista: la puerta está en la banda.
    fireEvent.click(screen.getByRole('button', { name: /See all 1 as list/ }));

    await waitFor(() => {
      expect(document.querySelector('.repertoire-home table')).toBeTruthy();
    });
    expect(screen.getByText('Drowsy Maggie')).toBeTruthy();
    expect(screen.queryByText('Morning Dew')).toBeNull();
  });

  it('la carta de la home no enseña el peldaño: eso es de la búsqueda (#9)', async () => {
    renderHome();

    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());

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

  it('el peldaño se pinta como cinco barras con su aria-label', async () => {
    renderTable();
    await ready();

    const icon = rowOf('Cooley’s Reel').querySelector('.rung')!;
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe(
      'Level: Solo-ready — Play it unaided and correctly — no one else needed.'
    );
    expect(icon.querySelectorAll('span').length).toBe(5);
    expect(icon.querySelectorAll('span.on').length).toBe(4);

    // Un peldaño bajo enciende solo la primera: las barras dicen la altura.
    // Y el backlog no enciende ninguna (#50).
    expect(rowOf('Drowsy Maggie').querySelectorAll('.rung span.on').length).toBe(0);
    expect(rowOf('The Cameron Highlanders').querySelectorAll('.rung span.on').length).toBe(1);
  });

  it('el menú abre el submenú del peldaño; elegir guarda y mueve icono, title y aria-label a la vez', async () => {
    renderTable();
    await ready();

    const row = rowOf('The Cameron Highlanders');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Actions for The Cameron Highlanders' })
    );

    // Segundo nivel: el menú principal dice el peldaño actual y el submenú trae
    // las cinco opciones, con la actual marcada.
    fireEvent.click(within(row).getByRole('button', { name: /^Level/ }));

    const options = within(row).getAllByRole('menuitemradio');
    expect(options.length).toBe(6);
    for (const option of options) {
      expect(option.textContent).toMatch(
        /to learn|know the parts|passages|someone else leads|unaided|show off/i
      );
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
    const described = 'Solo-ready — Play it unaided and correctly — no one else needed.';
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

  it('el backlog tiene puerta propia y su listado trae «Start learning» (#50)', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());

    // La cabecera lo nombra y es la puerta: la home no tiene banda de backlog.
    // En la tabla del listado, la pieza del backlog es Drowsy Maggie.
    fireEvent.click(screen.getByRole('button', { name: /1 to learn/ }));
    await waitFor(() => expect(document.querySelector('.repertoire-home table')).toBeTruthy());
    expect(screen.getByText('Drowsy Maggie')).toBeTruthy();
    expect(document.body.textContent).toContain('Backlog');

    // La acción que saca la pieza del backlog guarda el salto a `learning`.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Drowsy Maggie' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Start learning/ }));

    await waitFor(() => expect(mockedSaveStatus).toHaveBeenCalledWith('row-drowsy', 'learning'));
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
    await waitFor(() => expect(screen.getByText('Cooley’s Reel')).toBeTruthy());

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

/**
 * Etiquetado en bloque (#48). La selección de la tabla guarda ids de **fila**
 * (`row-*`), pero a la RPC viajan los de **tune** (`t-*`): el fixture los
 * mantiene distintos a propósito, porque un test que afirme `row-*` fija el
 * defecto (23503) en vez de cazarlo.
 */
describe('etiquetado en bloque desde la tabla (#48)', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(TABLE_ROWS as any);
  });

  async function ready(count = TABLE_ROWS.length) {
    await waitFor(() => expect(rowTitles().length).toBe(count));
  }

  it('marca dos filas y aplica una etiqueta en UNA llamada, con los ids de tune', async () => {
    renderTable();
    await ready();

    fireEvent.click(screen.getByLabelText('Drowsy Maggie'));
    fireEvent.click(screen.getByLabelText('Cooley’s Reel'));

    expect(screen.getByText('2 selected')).toBeTruthy();
    // Marcar no reordena ni recarga: la tabla sigue en el orden de urgencia y
    // `fetchRepertoire` se pidió una sola vez al montar.
    expect(rowTitles()).toEqual([
      'Drowsy Maggie',
      'Cooley’s Reel',
      'The Cameron Highlanders',
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tag selection' }));
    fireEvent.click(await screen.findByLabelText('Donegal'));

    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

    await waitFor(() => expect(mockedAddTuneTags).toHaveBeenCalledTimes(1));
    // Los ids de TUNE, en el orden de las filas; no los de `pr_repertoire`.
    expect(mockedAddTuneTags).toHaveBeenCalledWith(['t-drowsy', 't-cooley'], [3]);
    const [sentIds] = mockedAddTuneTags.mock.calls[0];
    expect(sentIds.every((id) => !id.startsWith('row-'))).toBe(true);

    // Después: aviso con lo escrito, selección limpia y panel cerrado.
    await waitFor(() => expect(screen.getByText('2 tunes tagged')).toBeTruthy());
    expect(screen.queryByText(/selected/)).toBeNull();
    expect((screen.getByLabelText('Drowsy Maggie') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('Donegal')).toBeNull();
  });

  it('«Apply» sin etiquetas está deshabilitado y no escribe; «Cancel» cierra sin escribir', async () => {
    renderTable();
    await ready();

    fireEvent.click(screen.getByLabelText('Drowsy Maggie'));
    fireEvent.click(screen.getByRole('button', { name: 'Tag selection' }));

    // El panel está abierto y el árbol se pinta, pero sin marcar nada.
    expect(await screen.findByLabelText('Donegal')).toBeTruthy();
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.click(apply);
    expect(mockedAddTuneTags).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Donegal')).toBeNull();
    // Cancelar no toca la selección de filas ni escribe nada.
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(mockedAddTuneTags).not.toHaveBeenCalled();
  });

  it('«Clear» vacía la selección y la barra desaparece', async () => {
    renderTable();
    await ready();

    fireEvent.click(screen.getByLabelText('Drowsy Maggie'));
    fireEvent.click(screen.getByLabelText('Cooley’s Reel'));
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tag selection' })).toBeNull();
    expect((screen.getByLabelText('Drowsy Maggie') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Cooley’s Reel') as HTMLInputElement).checked).toBe(false);
    expect(mockedAddTuneTags).not.toHaveBeenCalled();
  });

  it('«select all» marca solo lo listado: el ámbito de un peldaño, no el repertorio entero', async () => {
    sessionStorage.setItem(VIEW_MODE_KEY, 'table');
    renderHome('/?band=learning');

    // El peldaño deja una sola fila pintada de las tres del repertorio.
    await waitFor(() => expect(rowTitles()).toEqual(['The Cameron Highlanders']));

    fireEvent.click(screen.getByLabelText('Select all listed tunes'));

    expect(screen.getByText('1 selected')).toBeTruthy();
    expect((screen.getByLabelText('The Cameron Highlanders') as HTMLInputElement).checked).toBe(
      true
    );
    expect(document.querySelectorAll('.table-wrap tbody .pick input:checked').length).toBe(1);

    // Y lo marcado es lo que viaja: solo esa tune, con su id de tune.
    fireEvent.click(screen.getByRole('button', { name: 'Tag selection' }));
    fireEvent.click(await screen.findByLabelText('Donegal'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(mockedAddTuneTags).toHaveBeenCalledWith(['t-cameron'], [3])
    );
    await waitFor(() => expect(screen.getByText('1 tune tagged')).toBeTruthy());

    // Sin ámbito, el «select all» marca las tres listadas y el recuento cuadra.
    fireEvent.click(screen.getByRole('button', { name: /Back to all/ }));
    await waitFor(() => expect(rowTitles().length).toBe(TABLE_ROWS.length));

    fireEvent.click(screen.getByLabelText('Select all listed tunes'));
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(document.querySelectorAll('.table-wrap tbody .pick input:checked').length).toBe(3);
  });

  it('si la escritura falla, el error va en role="alert" y la selección sigue en pie', async () => {
    mockedAddTuneTags.mockRejectedValue(new Error('Could not add the tags: boom'));
    renderTable();
    await ready();

    fireEvent.click(screen.getByLabelText('Drowsy Maggie'));
    fireEvent.click(screen.getByRole('button', { name: 'Tag selection' }));
    fireEvent.click(await screen.findByLabelText('Donegal'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const alert = await waitFor(() => {
      const node = screen.getByText('Could not add the tags: boom');
      expect(node.getAttribute('role')).toBe('alert');
      return node;
    });
    expect(alert).toBeTruthy();

    // No se limpia nada: la fila sigue marcada, la barra sigue y la etiqueta
    // sigue elegida, para reintentar sin volver a marcar.
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect((screen.getByLabelText('Drowsy Maggie') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Donegal') as HTMLInputElement).checked).toBe(true);
  });

  /**
   * La selección se acota a lo que está listado. Sin esa poda, marcar una fila y
   * cambiar de ámbito dejaría «1 selected» sobre una tune que ya no se ve —y el
   * Apply la etiquetaría igual—: un recuento que no cuadra con la pantalla.
   */
  it('una fila marcada que deja de estar listada no cuenta ni viaja al Apply', async () => {
    renderTable();
    await ready();

    // Cooley's es `solo_ready`: se marca en la tabla sin ámbito.
    fireEvent.click(screen.getByLabelText('Cooley’s Reel'));
    expect(screen.getByText('1 selected')).toBeTruthy();

    // Se pasa a rejilla para poder aislar un peldaño, y se aísla Learning, donde
    // Cooley's no está. Al volver a la tabla, la fila marcada ya no se lista.
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show only Learning' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Table' }));

    await waitFor(() => expect(screen.queryByText('Cooley’s Reel')).toBeNull());
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tag selection' })).toBeNull();
    // Y la fila del ámbito sí está, para no confundir «vacío» con «acotado».
    expect(screen.getByText('The Cameron Highlanders')).toBeTruthy();
  });
});

/**
 * Banco de trabajo (#52): `learning` deja de ser una banda de biblioteca.
 *
 * Aquí se prueba lo que solo se ve montando la pantalla —la lista en vez de
 * cartas, el orden por dwell, el tope en la cabecera y su efecto en la puerta del
 * backlog—; la aritmética vive en `repertoire-model.test.ts`.
 */
describe('banco de trabajo (#52)', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  function learningRow(id: string, name: string, dwell: number, practices: number) {
    return row({
      id,
      status: 'learning',
      status_changed_at: daysAgo(dwell),
      practice_count: practices,
      tune: { ...row().tune, id: `t-${id}`, name },
    });
  }

  it('learning se pinta como lista de trabajo, con el dwell delante y sin cartas', async () => {
    mockedFetch.mockResolvedValue([
      learningRow('wb-new', 'Brand New Tune', 2, 0),
      learningRow('wb-stuck', 'Stuck Tune', 40, 3),
      row({
        id: 'row-solo',
        status: 'solo_ready',
        tune: { ...row().tune, id: 't-solo', name: 'Drowsy Maggie' },
      }),
    ] as any);

    renderHome('/?band=learning');
    await waitFor(() => expect(screen.getByText('Stuck Tune')).toBeTruthy());

    const band = document.querySelector('[data-band="learning"]') as HTMLElement;
    // Ni una carta: en el taller la foto no sirve, la tune no se toca en sesión.
    expect(band.querySelectorAll('.card').length).toBe(0);
    // El orden es el dwell, no el abandono: la más atascada primero.
    const titles = Array.from(band.querySelectorAll('.wb-title a')).map((node) => node.textContent);
    expect(titles).toEqual(['Stuck Tune', 'Brand New Tune']);
    // Y la fila dice lo que sirve para decidir.
    const stuck = band.querySelectorAll('.workbench li')[0] as HTMLElement;
    expect(stuck.textContent).toContain('40 days');
    expect(stuck.textContent).toContain('3');
    expect(stuck.textContent).toContain('practices');
  });

  it('la cabecera del taller dice cuánto ocupa del tope y cuánto sobra', async () => {
    const bulk = Array.from({ length: 8 }, (_, index) =>
      learningRow(`wb-${index}`, `Bench Tune ${index}`, index, 0)
    );
    mockedFetch.mockResolvedValue(bulk as any);

    renderHome();
    const band = await waitFor(() => {
      const node = document.querySelector('[data-band="learning"]') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    // Seis por defecto: ocho en el taller son dos de más.
    await waitFor(() => expect(band.textContent).toContain('8 of 6 slots'));
    expect(band.textContent).toContain('over by 2');
  });

  it('el tope se ajusta en la propia banda y queda guardado', async () => {
    mockedFetch.mockResolvedValue([
      learningRow('wb-a', 'Bench Tune A', 3, 1),
      learningRow('wb-b', 'Bench Tune B', 9, 0),
    ] as any);

    renderHome();
    await waitFor(() => expect(screen.getByText('Bench Tune A')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'More learning slots' }));

    await waitFor(() => expect(document.body.textContent).toContain('2 of 7 slots'));
    expect(readPrefs(localStorage).learningSlots).toBe(7);
  });

  it('con el taller lleno, «Start learning» no deja entrar sin sacar una', async () => {
    const bulk = [
      ...Array.from({ length: 6 }, (_, index) =>
        learningRow(`wb-${index}`, `Bench Tune ${index}`, index, 0)
      ),
      row({
        id: 'row-backlog',
        status: 'to_learn',
        tune: { ...row().tune, id: 't-back', name: 'Morning Dew' },
      }),
    ];
    mockedFetch.mockResolvedValue(bulk as any);

    renderHome();
    await waitFor(() => expect(screen.getByText('Bench Tune 0')).toBeTruthy());

    // La puerta del backlog está en la cabecera; su listado trae el menú.
    fireEvent.click(screen.getByRole('button', { name: /1 to learn/ }));
    await waitFor(() => expect(document.querySelector('.repertoire-home table')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Morning Dew' }));

    const start = screen.getByRole('menuitem', { name: /Start learning/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(document.body.textContent).toContain('The workbench is full');
  });
});
