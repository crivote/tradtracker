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
    findTodaySession: vi.fn(),
    createSessionWithMarks: vi.fn(),
    addSessionMarks: vi.fn(),
    unmarkSessionTune: vi.fn(),
  };
});

vi.mock('../lib/tradtube', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tradtube')>();
  return { ...actual, fetchSegments: vi.fn() };
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
  findTodaySession,
  unmarkSessionTune,
} from '../lib/practice';
import {
  readPrefs,
  readTodayList,
  todayKeyFor,
  writePrefs,
  writeTodayList,
} from '../lib/practice-storage';
import { fetchSegments } from '../lib/tradtube';
import Practice from './Practice';

const mockedFetch = vi.mocked(fetchRepertoire);
const mockedFavorite = vi.mocked(saveFavorite);
const mockedFind = vi.mocked(findTodaySession);
const mockedSegments = vi.mocked(fetchSegments);
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
  mockedFind.mockResolvedValue(null);
  mockedCreate.mockResolvedValue('session-new');
  mockedAdd.mockResolvedValue(1);
  mockedUnmark.mockResolvedValue(undefined);
  mockedFavorite.mockResolvedValue(undefined);
  mockedSegments.mockResolvedValue(new Map());
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

  it('re-congelar el mismo día reemplaza la entrada del histórico en vez de duplicarla', async () => {
    renderPractice();
    await waitForRows(8);

    const stepUp = document.querySelector('[aria-label="Increase daily target"]') as HTMLElement;
    fireEvent.click(stepUp);
    await waitForRows(9);

    const stored = JSON.parse(localStorage.getItem('tt-practice-recent') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].ids).toHaveLength(9);
  });

  it('pide los vídeos de la lista en UNA sola llamada, con el origin_ref de cada fila', async () => {
    renderPractice();
    await waitForRows(8);

    await waitFor(() => expect(mockedSegments).toHaveBeenCalledTimes(1));
    const refs = mockedSegments.mock.calls[0][0];
    expect(refs).toHaveLength(8);
    expect(new Set(refs).size).toBe(8);
    expect(refs.every((ref) => typeof ref === 'string')).toBe(true);
  });

  it('si TradTube no responde, avisa una vez y la lista sigue sirviendo', async () => {
    mockedSegments.mockRejectedValueOnce(new Error('tradtube caído'));
    renderPractice();
    await waitForRows(8);

    await waitFor(() => expect(document.querySelector('.practice-media-hint')).not.toBeNull());
    expect(document.querySelectorAll('.practice-row')).toHaveLength(8);
  });

  it('la fila cablea vídeo y reproductor, y el vídeo solo aparece donde hay segmento', async () => {
    mockedSegments.mockImplementation(async (refs) =>
      new Map(
        refs.map((ref) => [
          ref,
          [
            {
              originRef: ref,
              mediaId: `m-${ref}`,
              title: null,
              youtubeId: 'abcdefghijk',
              startSec: 0,
              endSec: 60,
              position: 0,
              unavailable: false,
            },
          ],
        ]),
      ),
    );

    renderPractice();
    await waitForRows(8);

    expect(document.querySelectorAll('.practice-row__media')).toHaveLength(8);
    expect(document.querySelectorAll('.practice-player')).toHaveLength(8);
    await waitFor(() => expect(document.querySelectorAll('.practice-video')).toHaveLength(8));
  });

  it('con ids congelados manda su orden, no el del generador', async () => {
    const today = todayKeyFor(Date.now());
    writeTodayList(localStorage, today, ['row-03', 'row-01', 'row-09'], 0);

    renderPractice();
    await waitForRows(3);

    expect(idsInOrder()).toEqual(['row-03', 'row-01', 'row-09']);
    // Y no se regeneró: la lista congelada sigue siendo la de tres.
    expect(readTodayList(localStorage, today)?.ids).toEqual(['row-03', 'row-01', 'row-09']);
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

  it('con sesión reanudada marca sin abrir otra', async () => {
    mockedFind.mockResolvedValue({ sessionId: 'session-open', markedIds: ['row-01'] });

    renderPractice();
    await waitForRows(8);

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
    // Las dos más vencidas: son las que encabezan la lista de ocho.
    mockedFind.mockResolvedValue({ sessionId: 'session-open', markedIds: ['row-12', 'row-11'] });

    renderPractice();
    await waitForRows(8);

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
    mockedFind.mockResolvedValue({
      sessionId: 'session-open',
      markedIds: ROWS.map((item) => item.id),
    });

    renderPractice();
    await waitForRows(8);

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

  it('el + del objetivo escribe prefs y reconstruye la lista', async () => {
    renderPractice();
    await waitForRows(8);
    expect(screenText()).toContain('12 overdue, 8 in the list');

    fireEvent.click(screen.getByRole('button', { name: 'Increase daily target' }));

    await waitForRows(9);
    expect(readPrefs(localStorage).dailyTarget).toBe(9);
    // Re-congelada con el objetivo nuevo: el aviso baja a 3 fuera.
    expect(readTodayList(localStorage, todayKeyFor(Date.now()))?.ids).toHaveLength(9);
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
