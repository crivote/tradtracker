// @vitest-environment node
/**
 * Adaptador de red con `fetch` simulado: lo que se comprueba aquí es lo que se
 * puede comprobar sin salir a internet —la forma de la petición (UA, `origin=*`,
 * `iiurlwidth=330`), la fusión de los carriles y la distinción de errores de
 * Pexels—. El cruce real vive en `image-search.integration.test.ts` y solo corre
 * con `RUN_IMAGE_INTEGRATION=1`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMONS_USER_AGENT, ImageSearchError, searchCommons, searchPexels } from './image-search';

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
  it('pide las cuatro consultas con UA propio, origin=* y miniaturas de 330', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      const search = url.searchParams.get('gsrsearch') ?? '';
      return jsonResponse(commonsPage(`${search.replace(/\W+/g, '-')}.jpg`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const candidates = await searchCommons('Drowsy Maggie', 'both');

    expect(fetchMock).toHaveBeenCalledTimes(4);
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

    // Cuatro carriles con un único resultado cada uno: el relleno no inventa.
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.source === 'commons')).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(4);
  });

  it('si un carril falla, el mosaico sigue con los demás', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const search = new URL(String(input)).searchParams.get('gsrsearch') ?? '';
      // Solo el carril de arte: la cadena de negación del carril foto también
      // lleva la palabra «painting», pero precedida de guion.
      if (search.includes(' painting')) throw new Error('boom');
      return jsonResponse(commonsPage(`${search.replace(/\W+/g, '-')}.jpg`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const candidates = await searchCommons('Butterfly');
    expect(candidates).toHaveLength(3);
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
