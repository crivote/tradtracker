// @vitest-environment jsdom
/**
 * La lista de ensayo del día (#36), montada de verdad.
 *
 * Lo que solo se ve montando: el orden congelado sobrevive al remontaje, la
 * sesión se crea con la primera marca y no al abrir, «Mark all» escribe solo lo
 * que falta, desmarcar llama a la capa que además recalcula la fecha, y el
 * corazón guarda el valor contrario al que había.
 *
 * `vitest` corre sin `globals`: sin `cleanup` explícito el DOM de una prueba se
 * cuela en la siguiente, y sin limpiar `localStorage` la lista congelada de una
 * prueba gobernaría la siguiente. Las dos cosas están en `beforeEach`/`afterEach`.
 *
 * El acceso a Supabase va simulado (lo que se prueba es el cableado de la
 * vista); el generador y el almacenamiento del día son los de verdad, que es
 * justo lo que este corte tiene que dejar demostrado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    fetchRepertoire: vi.fn(),
    saveFavorite: vi.fn(),
  };
});

vi.mock('../lib/practice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/practice')>();
  return {
    ...actual,
    fetchSessionMarks: vi.fn(),
    createSessionWithMarks: vi.fn(),
    addSessionMarks: vi.fn(),
    unmarkSessionTune: vi.fn(),
  };
});

vi.mock('../lib/catalogue-db', () => ({
  preloadCatalogue: vi.fn(async () => undefined),
  searchCatalogue: vi.fn(async () => []),
  getCatalogueStats: vi.fn(async () => ({ tunes: 0 })),
  lookupCatalogueMeters: vi.fn(async () => new Map()),
}));

vi.mock('../lib/session', () => ({
  useSession: () => ({
    session: () => ({ user: { id: 'user-1' } }),
    ready: () => true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { fetchRepertoire, saveFavorite } from '../lib/repertoire';
import {
  addSessionMarks,
  createSessionWithMarks,
  fetchSessionMarks,
  unmarkSessionTune,
} from '../lib/practice';
import {
  readPlan,
  readPrefs,
  todayKeyFor,
  writePlan,
  writePrefs,
} from '../lib/practice-storage';
import Practice from './Practice';

const mockedFetch = vi.mocked(fetchRepertoire);
const mockedFavorite = vi.mocked(saveFavorite);
const mockedMarks = vi.mocked(fetchSessionMarks);
const mockedCreate = vi.mocked(createSessionWithMarks);
const mockedAdd = vi.mocked(addSessionMarks);
const mockedUnmark = vi.mocked(unmarkSessionTune);

const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/**
 * Doce tunes en rotación, todas vencidas: la urgencia manda y el orden es
 * determinista (más días sin tocar primero), así que la lista se puede afirmar
 * fila a fila. El objetivo por defecto (8) deja 4 fuera y produce el aviso de
 * desbordamiento con la cifra del encargo: «12 overdue, 8 in the list».
 */
function row(index: number, overrides: Record<string, any> = {}) {
  const n = String(index).padStart(2, '0');
  return {
    id: `row-${n}`,
    status: 'learning',
    shelved: false,
    favorite: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: null,
    added_at: daysAgo(200),
    last_practiced_at: daysAgo(60 + index),
    tune: {
      id: `tune-${n}`,
      origin: 'thesession',
      origin_ref: String(n),
      name: `Tune ${n}`,
      rhythm: index % 2 === 0 ? 'Reel' : 'Jig',
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

const ROWS = Array.from({ length: 12 }, (_, i) => row(i + 1));

/**
 * Las ocho primeras de la lista por defecto: la más vencida encabeza. Se usa al
 * sembrar una lista guardada para que la prueba no dependa de regenerarla.
 */
const OVERDUE_FIRST = [
  'row-12',
  'row-11',
  'row-10',
  'row-09',
  'row-08',
  'row-07',
  'row-06',
  'row-05',
];

/** Siembra la lista viva tal y como la habría dejado una sesión anterior. */
function seedPlan(overrides: Partial<Parameters<typeof writePlan>[1]> = {}) {
  const plan = {
    createdAt: Date.now() - 60_000,
    ids: OVERDUE_FIRST,
    overflow: 4,
    sessionId: null,
    ...overrides,
  };
  writePlan(localStorage, plan);
  return plan;
}

function renderPractice() {
  const history = createMemoryHistory();
  history.set({ value: '/practice' });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/practice" component={Practice} />
    </MemoryRouter>
  ));
}

/** Ids de las filas pintadas, en el orden en que se leen. */
function idsInOrder(): string[] {
  return Array.from(document.querySelectorAll('.practice-row__title')).map((title) => {
    const n = (title.textContent ?? '').replace('Tune ', '');
    return `row-${n}`;
  });
}

function titlesInOrder(): string[] {
  return Array.from(document.querySelectorAll('.practice-row__title')).map(
    (title) => title.textContent ?? '',
  );
}

/** Texto de la pantalla con los espacios normalizados (el JSX parte nodos). */
function screenText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

async function waitForRows(count: number) {
  await waitFor(() => expect(document.querySelectorAll('.practice-row').length).toBe(count));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  mockedFetch.mockResolvedValue(ROWS as any);
  mockedMarks.mockResolvedValue([]);
  mockedCreate.mockResolvedValue('session-new');
  mockedAdd.mockResolvedValue(1);
  mockedUnmark.mockResolvedValue(undefined);
  mockedFavorite.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('lista del día (#36)', () => {
  it('pinta 8 filas y el mismo orden tras remontar', async () => {
    renderPractice();
    await waitForRows(8);

    const before = idsInOrder();
    expect(before).toHaveLength(8);

    cleanup();
    renderPractice();
    await waitForRows(8);

    // Misma semilla y misma fecha: la lista congelada se relee, no se regenera.
    expect(idsInOrder()).toEqual(before);
  });

  it('congelar la lista la deja en el histórico (la penalización ×0,5 de D3 no lee de la nada)', async () => {
    renderPractice();
    await waitForRows(8);

    const stored = JSON.parse(localStorage.getItem('tt-practice-recent') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].date).toBe(todayKeyFor(Date.now()));
    expect(stored[0].ids).toEqual(idsInOrder());
  });

  it('el objetivo diario no toca la lista viva: decide el tamaño de la próxima', async () => {
    renderPractice();
    await waitForRows(8);

    const before = idsInOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Increase daily target' }));

    await waitFor(() => expect(readPrefs(localStorage).dailyTarget).toBe(9));
    // La lista es inmutable: sigue la de ocho, con su instante de generación.
    expect(idsInOrder()).toEqual(before);
    expect(readPlan(localStorage, Date.now())?.ids).toEqual(before);
    expect(screenText()).toContain('12 overdue, 8 in the list');
  });

  it('cada fila trae el disparador del dock y ninguna monta transporte propio', async () => {
    renderPractice();
    await waitForRows(8);

    // El disparador es el mismo en las cuatro superficies (#49) y lleva el
    // título de su tune en el nombre accesible.
    const triggers = document.querySelectorAll('.practice-row .play-trigger');
    expect(triggers).toHaveLength(8);
    expect(triggers[0].getAttribute('aria-label')).toMatch(/^Play /);

    // La barra por fila y el iframe por fila se retiraron: un dock, no ocho.
    expect(document.querySelectorAll('.practice-player')).toHaveLength(0);
    expect(document.querySelectorAll('.practice-video')).toHaveLength(0);
    expect(document.querySelectorAll('.practice-row__media')).toHaveLength(0);
  });

  it('la lista guardada manda: su orden, y no se genera otra', async () => {
    const seeded = seedPlan({ ids: ['row-03', 'row-01', 'row-09'], overflow: 0 });

    renderPractice();
    await waitForRows(3);

    expect(idsInOrder()).toEqual(['row-03', 'row-01', 'row-09']);
    // Y no se regeneró: la lista guardada sigue siendo la de tres, con su fecha.
    expect(readPlan(localStorage, Date.now())).toEqual(seeded);
  });

  it('la marca de una tune sin sesión previa abre la sesión y deja la fila marcada', async () => {
    renderPractice();
    await waitForRows(8);

    const firstId = idsInOrder()[0];
    const markButton = document.querySelector('.practice-row .practice-row__mark') as HTMLElement;
    fireEvent.click(markButton);

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith([{ repertoireId: firstId, position: 0 }]);
    expect(mockedAdd).not.toHaveBeenCalled();

    await waitFor(() => expect(markButton.textContent).toContain('Marked'));
  });

  it('con la sesión de la lista guardada, reanuda sus marcas y no abre otra', async () => {
    seedPlan({ sessionId: 'session-open' });
    mockedMarks.mockResolvedValue(['row-12']);

    renderPractice();
    await waitForRows(8);
    await waitFor(() => expect(screenText()).toContain('1 marked'));
    // Las marcas se piden a la sesión de la lista, por id.
    expect(mockedMarks).toHaveBeenCalledWith('session-open');

    const rows = document.querySelectorAll('.practice-row');
    const target = rows[1] as HTMLElement;
    fireEvent.click(target.querySelector('.practice-row__mark') as HTMLElement);

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedAdd).toHaveBeenCalledWith('session-open', [
      { repertoireId: idsInOrder()[1], position: 1 },
    ]);
  });

  it('«Mark all» escribe solo las que faltan y dos pulsaciones no duplican', async () => {
    // Las dos más vencidas (row-12 y row-11) ya estaban marcadas.
    seedPlan({ sessionId: 'session-open' });
    mockedMarks.mockResolvedValue(['row-12', 'row-11']);

    renderPractice();
    await waitForRows(8);
    await waitFor(() => expect(screenText()).toContain('2 marked'));

    fireEvent.click(screen.getByRole('button', { name: /^Mark all$/ }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    const [, marks] = mockedAdd.mock.calls[0];
    // Dos de las ocho ya estaban marcadas: seis marcas, no ocho.
    expect(marks).toHaveLength(6);
    expect(mockedCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Mark all$/ }));
    await waitFor(() => expect(screenText()).toContain('8 marked'));
    expect(mockedAdd).toHaveBeenCalledTimes(1);
  });

  it('desmarcar llama a la capa que borra y recalcula, con la fila correcta', async () => {
    seedPlan({ sessionId: 'session-open' });
    mockedMarks.mockResolvedValue(OVERDUE_FIRST);

    renderPractice();
    await waitForRows(8);
    await waitFor(() => expect(screenText()).toContain('8 marked'));

    const firstId = idsInOrder()[0];
    fireEvent.click(screen.getByRole('button', { name: `Unmark Tune ${firstId.slice(-2)}` }));

    await waitFor(() => expect(mockedUnmark).toHaveBeenCalledTimes(1));
    expect(mockedUnmark).toHaveBeenCalledWith('session-open', firstId);
  });

  it('el aviso de desbordamiento lleva la cifra congelada y sigue tras remontar', async () => {
    renderPractice();
    await waitForRows(8);

    expect(screenText()).toContain('12 overdue, 8 in the list');

    cleanup();
    renderPractice();
    await waitForRows(8);

    expect(screenText()).toContain('12 overdue, 8 in the list');
  });

  it('el corazón guarda el valor contrario al actual', async () => {
    mockedFetch.mockResolvedValue([...ROWS.slice(0, 11), row(12, { favorite: true })] as any);

    renderPractice();
    await waitForRows(8);

    // La fila favorita es la que lleva el corazón relleno y su aria-label propio.
    const heart = screen.getByRole('button', { name: /^Remove .* from favourites$/ });
    expect(heart.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(heart);

    await waitFor(() => expect(mockedFavorite).toHaveBeenCalledTimes(1));
    expect(mockedFavorite).toHaveBeenCalledWith('row-12', false);
    await waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('false'));
  });

  it('si el guardado de la favorita falla, se revierte y se dice', async () => {
    mockedFetch.mockResolvedValue([...ROWS.slice(0, 11), row(12, { favorite: true })] as any);
    mockedFavorite.mockRejectedValue(new Error('Could not save the favourite: nope'));

    renderPractice();
    await waitForRows(8);

    const heart = screen.getByRole('button', { name: /^Remove .* from favourites$/ });
    fireEvent.click(heart);

    await waitFor(() => expect(screenText()).toContain('Could not save the favourite: nope'));
    // El corazón vuelve a como estaba: nada de favoritas fantasma.
    expect(heart.getAttribute('aria-pressed')).toBe('true');
  });

  it('tras subir el objetivo, «New list» genera la lista del tamaño nuevo', async () => {
    renderPractice();
    await waitForRows(8);
    expect(screenText()).toContain('12 overdue, 8 in the list');

    fireEvent.click(screen.getByRole('button', { name: 'Increase daily target' }));
    await waitFor(() => expect(readPrefs(localStorage).dailyTarget).toBe(9));
    // Subir el objetivo no toca la lista viva.
    expect(document.querySelectorAll('.practice-row')).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace this list?' }));

    await waitFor(() => expect(document.querySelectorAll('.practice-row')).toHaveLength(9));
    expect(readPlan(localStorage, Date.now())?.ids).toHaveLength(9);
    // Nueve de doce en la lista: tres se quedan fuera.
    expect(screenText()).toContain('12 overdue, 9 in the list');
  });

  it('una fila marcada no desaparece de la lista', async () => {
    renderPractice();
    await waitForRows(8);

    const before = idsInOrder();
    const firstRow = document.querySelector('.practice-row') as HTMLElement;
    fireEvent.click(firstRow.querySelector('.practice-row__mark') as HTMLElement);

    await waitFor(() => expect(firstRow.classList.contains('is-marked')).toBe(true));
    expect(idsInOrder()).toEqual(before);
    expect(firstRow.textContent).toContain('Marked ✓');
  });

  it('recargar conserva la lista y sus marcas: la sesión va escrita en la lista', async () => {
    renderPractice();
    await waitForRows(8);

    const firstId = idsInOrder()[0];
    fireEvent.click(document.querySelector('.practice-row .practice-row__mark') as HTMLElement);
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screenText()).toContain('1 marked'));

    // La primera marca dejó la sesión escrita junto a la lista.
    const stored = readPlan(localStorage, Date.now());
    expect(stored?.sessionId).toBe('session-new');
    expect(stored?.ids).toEqual(idsInOrder());

    // Recarga —o volver de un enlace de The Session—: las marcas se piden a ESA
    // sesión, no a «la última abierta de hoy». Era el bug de las sesiones de una
    // línea: cada recarga perdía todas menos la última.
    cleanup();
    mockedMarks.mockResolvedValue([firstId]);
    renderPractice();
    await waitForRows(8);

    await waitFor(() => expect(mockedMarks).toHaveBeenCalledWith('session-new'));
    await waitFor(() => expect(screenText()).toContain('1 marked'));
    expect(idsInOrder()).toEqual(stored?.ids);
    expect(document.querySelectorAll('.practice-row.is-marked')).toHaveLength(1);
    // No se abrió una sesión nueva por la recarga.
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('«New list» pide confirmación y genera otra sin marcas', async () => {
    renderPractice();
    await waitForRows(8);
    fireEvent.click(document.querySelector('.practice-row .practice-row__mark') as HTMLElement);
    await waitFor(() => expect(screenText()).toContain('1 marked'));

    const before = readPlan(localStorage, Date.now());

    // Primera pulsación: arma, no destruye.
    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Replace this list?' })).toBeTruthy(),
    );
    expect(readPlan(localStorage, Date.now())?.createdAt).toBe(before?.createdAt);

    // Segunda: la sustituye, sin sesión y sin marcas.
    fireEvent.click(screen.getByRole('button', { name: 'Replace this list?' }));
    await waitFor(() => expect(screenText()).toContain('0 marked'));

    const after = readPlan(localStorage, Date.now());
    expect(after?.sessionId).toBeNull();
    expect(after?.createdAt).not.toBe(before?.createdAt);
    expect(document.querySelectorAll('.practice-row.is-marked')).toHaveLength(0);
  });

  it('con toda la lista marcada lo dice y remite a «New list», sin refrescarse sola', async () => {
    seedPlan({ sessionId: 'session-open' });
    mockedMarks.mockResolvedValue(OVERDUE_FIRST);

    renderPractice();
    await waitForRows(8);
    await waitFor(() => expect(screenText()).toContain('All 8 tunes marked.'));

    // Completa no es sinónimo de caducada: la lista sigue siendo la misma.
    expect(idsInOrder()).toEqual(OVERDUE_FIRST);
  });

  it('el backlog no entra en la lista, por viejo que sea (#50)', async () => {
    mockedFetch.mockResolvedValue([
      ...ROWS,
      // Un deseo de hace dos años y medio: antes encabezaba la lista.
      row(99, { status: 'to_learn', added_at: daysAgo(900), last_practiced_at: null }),
    ] as any);

    renderPractice();
    await waitForRows(8);

    expect(idsInOrder()).not.toContain('row-99');
    // Y la lista sigue siendo la de ocho: el backlog no ocupa hueco.
    expect(document.querySelectorAll('.practice-row')).toHaveLength(8);
  });

  it('sin repertorio lo dice y ofrece la puerta para añadir tunes', async () => {
    mockedFetch.mockResolvedValue([] as any);

    renderPractice();

    await waitFor(() => expect(screenText()).toContain('Nothing to practice yet.'));
    expect(screen.getByRole('link', { name: 'Add some tunes' })).toBeTruthy();
  });

  it('si el repertorio no carga, lo dice y deja reintentar', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('Could not load your repertoire: boom'));

    renderPractice();

    await waitFor(() =>
      expect(screenText()).toContain('Could not load your repertoire: boom'),
    );

    // «Try again» repite la carga con el doble ya bueno.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitForRows(8);
  });

  it('el objetivo diario respeta los topes del esquema', async () => {
    writePrefs(localStorage, { instrument: 'fiddle', dailyTarget: 20 });

    renderPractice();
    await waitForRows(12);

    fireEvent.click(screen.getByRole('button', { name: 'Increase daily target' }));

    // Ya está en el máximo: no escribe ni reconstruye.
    expect(readPrefs(localStorage).dailyTarget).toBe(20);
    expect(document.querySelectorAll('.practice-row')).toHaveLength(12);
  });
});
