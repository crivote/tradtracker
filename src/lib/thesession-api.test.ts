// @vitest-environment node
/**
 * Adaptador de red del tunebook con `fetch` simulado (issue #32).
 *
 * Se comprueba lo que se puede comprobar sin salir a internet: la forma de la
 * petición (`perpage=50`, `format=json`), el ensamblado de páginas, el
 * deduplicado y la clasificación de errores —el 410 de una cuenta borrada no es
 * un 404—. No hay red en esta suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_API_BASE,
  SESSION_PAGE_DELAY_MS,
  SessionImportError,
  fetchTunebook,
  searchMembers,
} from './thesession-api';
import { SESSION_MAX_PAGES, SESSION_PER_PAGE } from './thesession-import';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Una página del tunebook con los tunes que se le pasen. */
function pageBody(page: number, pages: number, tunes: Array<Record<string, unknown>>) {
  return {
    format: 'json',
    perpage: String(SESSION_PER_PAGE),
    pages,
    page,
    total: tunes.length,
    member: { id: 99727, name: 'victor gomez' },
    tunes,
  };
}

function rawTune(id: number, name: string) {
  return {
    id,
    name,
    url: `https://thesession.org/tunes/${id}`,
    date: '2007-03-19 14:42:48',
    type: 'reel',
    added: '2022-11-16 17:58:44',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTunebook', () => {
  it('pide la primera página con perpage=50 y format=json', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse(pageBody(1, 1, [rawTune(6970, '72nd')]))
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchTunebook(99727);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(`${SESSION_API_BASE}/members/99727/tunebook`);
    expect(url.searchParams.get('perpage')).toBe('50');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('ensambla dos páginas, avisa por cada una y deduplica el tune repetido', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      if (page === 1) return jsonResponse(pageBody(1, 2, [rawTune(6970, '72nd')]));
      return jsonResponse(pageBody(2, 2, [rawTune(1075, 'Britches'), rawTune(6970, '72nd')]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const seen: number[] = [];
    const tunes = await fetchTunebook(99727, (page) => seen.push(page.page));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([1, 2]);
    expect(tunes.map((tune) => tune.tuneId)).toEqual([6970, 1075]);
  });

  it('un tunebook vacío devuelve la lista vacía sin pedir más páginas', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pageBody(1, 1, [])));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTunebook(99727)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('traduce el 410 de una cuenta borrada a «gone»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ format: 'json', error: '410: Gone' }, 410))
    );

    const error = await fetchTunebook(99727).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SessionImportError);
    expect((error as SessionImportError).kind).toBe('gone');
    expect((error as SessionImportError).status).toBe(410);
  });

  it('un 500 llega como «http» con el código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)));

    const error = await fetchTunebook(99727).catch((cause: unknown) => cause);
    expect((error as SessionImportError).kind).toBe('http');
    expect((error as SessionImportError).status).toBe(500);
  });

  it('un fetch que rechaza llega como «network»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    const error = await fetchTunebook(99727).catch((cause: unknown) => cause);
    expect((error as SessionImportError).kind).toBe('network');
    expect((error as SessionImportError).message).toContain('thesession.org');
  });

  it('un tunebook por encima del techo se rechaza sin pedir la segunda página', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(pageBody(1, SESSION_MAX_PAGES + 1, [rawTune(6970, '72nd')]))
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await fetchTunebook(99727).catch((cause: unknown) => cause);
    expect((error as SessionImportError).kind).toBe('too-large');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('espera entre páginas y no tras la última', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const page = Number(new URL(String(input)).searchParams.get('page'));
        return jsonResponse(pageBody(page, 2, [rawTune(page, `Tune ${page}`)]));
      });
      vi.stubGlobal('fetch', fetchMock);

      const pending = fetchTunebook(99727);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SESSION_PAGE_DELAY_MS);
      await pending;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('searchMembers', () => {
  it('no sale a la red con una consulta vacía', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchMembers('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca por nombre y devuelve id, nombre y bio', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({
        q: 'crivote',
        total: 1,
        members: [{ id: 99727, name: 'victor gomez', url: 'https://thesession.org/members/99727', date: '', bio: '' }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchMembers(' crivote ')).resolves.toEqual([
      { id: 99727, name: 'victor gomez', bio: null },
    ]);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(`${SESSION_API_BASE}/members/search`);
    expect(url.searchParams.get('q')).toBe('crivote');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('propaga el fallo de red con su clase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    const error = await searchMembers('crivote').catch((cause: unknown) => cause);
    expect((error as SessionImportError).kind).toBe('network');
  });
});
