// @vitest-environment node
/**
 * Adaptador de red con `fetch` simulado: lo que se comprueba aquí es lo que se
 * puede comprobar sin salir a internet —la forma de la petición (UA, `origin=*`,
 * `iiurlwidth=330`), la fusión de los carriles y la distinción de errores de
 * Pexels—. El cruce real vive en `image-search.integration.test.ts` y solo corre
 * con `RUN_IMAGE_INTEGRATION=1`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIC_POOL } from './image-sources';
import {
  COMMONS_USER_AGENT,
  ImageSearchError,
  searchArtic,
  searchCommons,
  searchPexels,
} from './image-search';

/** Respuesta JSON mínima para el mock de `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Una página de Commons con una sola imagen, para poblar un carril. */
function commonsPage(name: string, width = 1200, height = 800) {
  return {
    query: {
      pages: {
        '1': {
          pageid: 1,
          index: 0,
          title: `File:${name}`,
          imageinfo: [
            {
              thumburl: `https://upload.wikimedia.org/thumb/${name}/330px-${name}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
              width,
              height,
              extmetadata: {
                Artist: { value: 'Anon' },
                LicenseShortName: { value: 'Public domain' },
              },
            },
          ],
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchCommons', () => {
  it('pide las cinco consultas (cuatro de arte y una de foto) con UA propio, origin=* y miniaturas de 330', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      const search = url.searchParams.get('gsrsearch') ?? '';
      expect(search.length).toBeGreaterThan(0);
      // Nombre neutro a propósito: si el fichero se llamara como la consulta,
      // el veto por medio leería «painting» en el nombre y descartaría el carril
      // de foto por una razón que no tiene nada que ver con la prueba.
      n += 1;
      return jsonResponse(commonsPage(`img${n}.jpg`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const candidates = await searchCommons('Drowsy Maggie', 'both');

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]));
      expect(url.searchParams.get('origin')).toBe('*');
      expect(url.searchParams.get('gsrnamespace')).toBe('6');
      expect(url.searchParams.get('gsrlimit')).toBeTruthy();
      // El cubo de 330: 21 KB por imagen en vez de 183 KB del de 960.
      expect(url.searchParams.get('iiurlwidth')).toBe('330');
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers['User-Agent']).toBe(COMMONS_USER_AGENT);
    }

    // Cinco carriles con un único resultado cada uno: no se inventa ninguno.
    expect(candidates).toHaveLength(5);
    expect(candidates.every((candidate) => candidate.source === 'commons')).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(5);
  });

  it('si un carril falla, el mosaico sigue con los demás', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const search = new URL(String(input)).searchParams.get('gsrsearch') ?? '';
      // Solo el carril de arte de la pintura: la cadena de negación del carril
      // foto también lleva la palabra, pero precedida de guion.
      if (search.includes(' painting')) throw new Error('boom');
      n += 1;
      return jsonResponse(commonsPage(`img${n}.jpg`));
    });
    vi.stubGlobal('fetch', fetchMock);

    // Cinco carriles, uno cae: quedan cuatro y el mosaico sigue.
    const candidates = await searchCommons('Butterfly');
    expect(candidates).toHaveLength(4);
  });

  it('sin red en ningún carril el error sube: no es «sin referente»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );

    await expect(searchCommons('Butterfly')).rejects.toBeInstanceOf(ImageSearchError);
    await expect(searchCommons('Butterfly')).rejects.toThrow(/Could not reach Wikimedia Commons/);
  });

  it('un 500 de Commons es error, no una lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));

    await expect(searchCommons('Butterfly')).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('searchPexels', () => {
  it('sin clave no hace ninguna petición y lo dice como aviso', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchPexels('Butterfly', '  ')).rejects.toMatchObject({ kind: 'missing-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda la clave en `Authorization` (sin Bearer) y pide landscape', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('orientation')).toBe('landscape');
      expect(url.searchParams.get('per_page')).toBe('9');
      return jsonResponse({ photos: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchPexels('Butterfly', 'clave-de-prueba');

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('clave-de-prueba');
  });

  it('distingue «clave rechazada» (401) de «sin clave»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)));

    await expect(searchPexels('Butterfly', 'clave-mala')).rejects.toMatchObject({
      kind: 'rejected',
    });
  });
});


describe('searchCommons: veto por categorías', () => {
  /** Devuelve un fichero cuyo medio declaran las categorías, no el nombre. */
  function pageFor(name: string, category: string) {
    return {
      query: {
        pages: {
          '1': {
            pageid: 1,
            index: 0,
            title: `File:${name}`,
            categories: [{ title: `Category:${category}` }],
            imageinfo: [
              {
                thumburl: `https://upload.wikimedia.org/thumb/${name}/330px-${name}`,
                width: 1200,
                height: 960,
                extmetadata: { LicenseShortName: { value: 'Public domain' } },
              },
            ],
          },
        },
      },
    };
  }

  it('en arte cae lo que las categorías declaran fotografía, y al revés', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const search = new URL(String(input)).searchParams.get('gsrsearch') ?? '';
      // El carril de foto es el único que lleva la negación.
      return search.includes('-painting')
        ? jsonResponse(pageFor('harbour-photo.jpg', 'Photographs by Roger Fenton'))
        : jsonResponse(pageFor('storm-painting.jpg', 'Marine paintings'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const art = await searchCommons('Butterfly', 'art');
    // Cuatro consultas devuelven el mismo fichero: se deduplica a uno.
    expect(art.map((item) => item.id)).toEqual(['storm-painting.jpg']);

    const photo = await searchCommons('Butterfly', 'photo');
    expect(photo.map((item) => item.id)).toEqual(['harbour-photo.jpg']);
  });

  it('lo que no declara medio se queda: el carril ya pedía ese medio', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const search = new URL(String(input)).searchParams.get('gsrsearch') ?? '';
      return jsonResponse(
        search.includes('-painting')
          ? pageFor('unknown-photo.jpg', 'May 2024 in Venice')
          : pageFor('unknown-art.jpg', 'May 2023 in Venice')
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await searchCommons('Butterfly', 'art')).toHaveLength(1);
    expect(await searchCommons('Butterfly', 'photo')).toHaveLength(1);
  });
});

describe('searchArtic', () => {
  it('pide el pozo con dominio público filtrado en servidor y sin clave', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({ data: [] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchArtic('Storm at Sea');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('query[term][is_public_domain]')).toBe('true');
    expect(url.searchParams.get('limit')).toBe(String(ARTIC_POOL));
    // Sin clave: no hay cabecera de autorización que enviar.
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('un 500 es error, no una lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    await expect(searchArtic('Butterfly')).rejects.toMatchObject({ kind: 'http' });
  });

  it('sin red el error nombra la fuente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await expect(searchArtic('Butterfly')).rejects.toThrow(/Art Institute/);
  });
});
