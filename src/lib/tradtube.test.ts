// @vitest-environment node
/**
 * El adaptador de TradTube (#37) con `fetch` simulado: aquí no se sale a
 * internet. Lo que se comprueba es justo lo que se puede comprobar sin red —
 * que la lista se pide **en una sola petición** con `tune_id=in.(…)`, que la
 * caché de sesión evita la segunda, que un fallo de red no se cachea, y que el
 * `end` del iframe **no** aparece cuando el segmento no declara fin.
 *
 * El cruce contra el servicio real vive en `tradtube.integration.test.ts` y solo
 * corre con `RUN_TRADTUBE_INTEGRATION=1`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEGMENT_BATCH_SIZE,
  TradtubeUnavailableError,
  clearSegmentCache,
  embedUrl,
  fetchSegments,
  parseSegmentRows,
  thumbnailUrl,
  youtubeIdFromUri,
  type TuneSegment,
} from './tradtube';

const BASE = 'https://tradtube.test.supabase.co';
const ANON = 'tradtube-anon-key';

/** Un segmento de mentira, con todo lo que necesita `embedUrl`. */
function segment(overrides: Partial<TuneSegment> = {}): TuneSegment {
  return {
    originRef: '67',
    mediaId: 'media-1',
    title: 'The Good Tune',
    youtubeId: 'e1-80u--A1o',
    startSec: 0,
    endSec: 140,
    position: 0,
    unavailable: false,
    ...overrides,
  };
}

/** Una fila de PostgREST tal y como la devuelve el servicio (medida). */
function row(
  tuneId: number,
  media: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { tune_id: tuneId, start_sec: 0, end_sec: 140, position: 0, media, ...extra };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearSegmentCache();
  vi.stubEnv('VITE_TRADTUBE_URL', BASE);
  vi.stubEnv('VITE_TRADTUBE_ANON', ANON);
});

afterEach(() => {
  clearSegmentCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('youtubeIdFromUri', () => {
  it('saca el id de las cuatro formas que hay en TradTube, con parámetros pegados', () => {
    expect(youtubeIdFromUri('https://www.youtube.com/watch?v=e1-80u--A1o')).toBe('e1-80u--A1o');
    expect(youtubeIdFromUri('https://youtu.be/fopTazmLTQA')).toBe('fopTazmLTQA');
    expect(youtubeIdFromUri('https://www.youtube.com/watch?v=OWL7HeSIZiw&t=30s')).toBe(
      'OWL7HeSIZiw'
    );
    expect(
      youtubeIdFromUri('https://www.youtube.com/watch?list=PL123&index=2&v=eRz54zsMab8')
    ).toBe('eRz54zsMab8');
  });

  it('devuelve null con basura, con otro dominio y con un id que no lo es', () => {
    expect(youtubeIdFromUri('')).toBeNull();
    expect(youtubeIdFromUri('   ')).toBeNull();
    expect(youtubeIdFromUri('not a url at all')).toBeNull();
    expect(youtubeIdFromUri('https://vimeo.com/123456789')).toBeNull();
    expect(youtubeIdFromUri('https://www.youtube.com/watch')).toBeNull();
    expect(youtubeIdFromUri('https://www.youtube.com/watch?v=tooShort')).toBeNull();
    expect(youtubeIdFromUri('https://youtu.be/')).toBeNull();
    // Un id de YouTube son 11 caracteres: 12 no es un id.
    expect(youtubeIdFromUri('https://youtu.be/e1-80u--A1ox')).toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('compone la miniatura de 320 × 180 de YouTube', () => {
    expect(thumbnailUrl('e1-80u--A1o')).toBe('https://i.ytimg.com/vi/e1-80u--A1o/mqdefault.jpg');
  });
});

describe('embedUrl', () => {
  it('pone start y end cuando el segmento declara fin', () => {
    const url = embedUrl(segment({ startSec: 239, endSec: 264 }));
    expect(url).toBe('https://www.youtube-nocookie.com/embed/e1-80u--A1o?start=239&end=264');
  });

  it('OMITE end cuando end_sec es null — `end=null` rompe el reproductor', () => {
    const url = embedUrl(segment({ startSec: 239, endSec: null }));
    expect(url).toBe('https://www.youtube-nocookie.com/embed/e1-80u--A1o?start=239');
    expect(url).not.toContain('end=');
  });
});

describe('parseSegmentRows', () => {
  it('convierte tune_id numérico a texto y respeta end_sec null', () => {
    const segments = parseSegmentRows([
      row(5, {
        id: 'cfd2d18e',
        title: 'le Ceoltóiri Cultúrlainne',
        media_uri: 'https://www.youtube.com/watch?v=fopTazmLTQA',
        hidden: false,
        unavailable: false,
        status: 'verified',
      }, { end_sec: null }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      originRef: '5',
      mediaId: 'cfd2d18e',
      title: 'le Ceoltóiri Cultúrlainne',
      youtubeId: 'fopTazmLTQA',
      startSec: 0,
      endSec: null,
      position: 0,
      unavailable: false,
    });
  });

  it('descarta la fila sin media, la de media_uri no parseable y la que no tiene tune_id', () => {
    const segments = parseSegmentRows([
      { tune_id: 67, start_sec: 0, end_sec: 140, position: 0 },
      row(67, {
        id: 'sin-video',
        title: 'nada',
        media_uri: 'https://vimeo.com/1',
        hidden: false,
        unavailable: false,
      }),
      { start_sec: 0, end_sec: 10, position: 0, media: { id: 'x', media_uri: 'https://youtu.be/fopTazmLTQA' } },
      null,
      'basura',
    ]);

    expect(segments).toEqual([]);
  });

  it('mantiene las unavailable MARCADAS y descarta las adivinanzas llm_guess', () => {
    const segments = parseSegmentRows([
      row(1, {
        id: 'gone',
        title: 'gone',
        media_uri: 'https://youtu.be/fopTazmLTQA',
        hidden: false,
        unavailable: true,
        status: 'verified',
      }),
      row(1, {
        id: 'guess',
        title: 'guess',
        media_uri: 'https://youtu.be/eRz54zsMab8',
        hidden: false,
        unavailable: false,
        status: 'llm_guess',
      }),
      row(1, {
        id: 'ok',
        title: 'ok',
        media_uri: 'https://youtu.be/OWL7HeSIZiw',
        hidden: false,
        unavailable: false,
        status: null,
      }),
    ]);

    expect(segments.map((s) => s.mediaId)).toEqual(['gone', 'ok']);
    expect(segments[0].unavailable).toBe(true);
    expect(segments[1].unavailable).toBe(false);
  });

  it('ordena por position, después startSec, después mediaId', () => {
    const make = (mediaId: string, position: number, startSec: number) =>
      row(
        5,
        {
          id: mediaId,
          title: mediaId,
          media_uri: `https://youtu.be/${mediaId.padEnd(11, 'x').slice(0, 11)}`,
          hidden: false,
          unavailable: false,
        },
        { position, start_sec: startSec, end_sec: null }
      );

    const segments = parseSegmentRows([
      make('b', 1, 10),
      make('c', 0, 40),
      make('a', 0, 40),
      make('d', 0, 5),
    ]);

    expect(segments.map((s) => s.mediaId)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('no revienta si el servicio devuelve cualquier cosa menos un array', () => {
    expect(parseSegmentRows(null)).toEqual([]);
    expect(parseSegmentRows({ message: 'nope' })).toEqual([]);
    expect(parseSegmentRows([])).toEqual([]);
  });
});

describe('fetchSegments', () => {
  function tenRefs(): string[] {
    return ['1', '2', '3', '4', '5', '9', '10', '67', '68', '69'];
  }

  it('pide la lista entera en UNA petición con tune_id=in.(…)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSegments(tenRefs());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('tune_id=in.(');
    expect(url).toContain('tune_id=in.(1,2,3,4,5,9,10,67,68,69)');
    expect(url).toContain('tune_media.hidden=eq.false');
    expect(url.startsWith(`${BASE}/rest/v1/tune_media_entries?`)).toBe(true);

    // La clave anónima va en las dos cabeceras: PostgREST sin `Authorization`
    // resuelve el rol anónimo y devuelve cero filas sin error.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.apikey).toBe(ANON);
    expect(headers.Authorization).toBe(`Bearer ${ANON}`);
  });

  it('agrupa por tune, ordena dentro de cada una y no devuelve las claves vacías', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        row(5, {
          id: 'media-b',
          title: 'B',
          media_uri: 'https://youtu.be/fopTazmLTQA',
          hidden: false,
          unavailable: false,
        }, { position: 1, end_sec: null }),
        row(5, {
          id: 'media-a',
          title: 'A',
          media_uri: 'https://youtu.be/eRz54zsMab8',
          hidden: false,
          unavailable: false,
        }, { position: 0, end_sec: 144 }),
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const map = await fetchSegments(['5', '67']);

    expect([...map.keys()]).toEqual(['5']);
    expect(map.get('5')?.map((s) => s.mediaId)).toEqual(['media-a', 'media-b']);
  });

  it('la segunda llamada con las mismas refs NO pide nada (caché de sesión)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSegments(tenRefs());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await fetchSegments(tenRefs());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.size).toBe(0);
  });

  it('no pide nada con la lista de refs vacía', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    expect((await fetchSegments([])).size).toBe(0);
    expect((await fetchSegments(['  ', ''])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplica refs antes de pedir', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSegments(['67', ' 67 ', '5', '5']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('tune_id=in.(67,5)');
  });

  it('un fallo de red lanza TradtubeUnavailableError y NO se cachea: la siguiente vuelve a intentar', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', failing);

    await expect(fetchSegments(['67'])).rejects.toBeInstanceOf(TradtubeUnavailableError);
    expect(failing).toHaveBeenCalledTimes(1);

    const ok = vi.fn(async () =>
      jsonResponse([
        row(67, {
          id: 'media-1',
          title: 'The Good Tune',
          media_uri: 'https://www.youtube.com/watch?v=e1-80u--A1o',
          hidden: false,
          unavailable: false,
        }),
      ])
    );
    vi.stubGlobal('fetch', ok);

    const map = await fetchSegments(['67']);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(map.get('67')?.map((s) => s.youtubeId)).toEqual(['e1-80u--A1o']);
  });

  it('una respuesta HTTP de error también es TradtubeUnavailableError, con su código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'nope' }, 401)));

    const caught = await fetchSegments(['67']).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(TradtubeUnavailableError);
    expect((caught as TradtubeUnavailableError).status).toBe(401);
  });

  it('trocea en tandas de 100', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const refs = Array.from({ length: SEGMENT_BATCH_SIZE * 2 + 1 }, (_, index) => String(index + 1));
    await fetchSegments(refs);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [firstUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const ids = firstUrl.split('tune_id=in.(')[1].split(')')[0].split(',');
    expect(ids).toHaveLength(SEGMENT_BATCH_SIZE);
  });

  it('sin variables devuelve un mapa vacío, avisa UNA vez y no pide nada', async () => {
    vi.stubEnv('VITE_TRADTUBE_URL', '');
    vi.stubEnv('VITE_TRADTUBE_ANON', '');
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await fetchSegments(['67'])).size).toBe(0);
    expect((await fetchSegments(['5'])).size).toBe(0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
