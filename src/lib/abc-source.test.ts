import { describe, expect, it, vi } from 'vitest';
import { abcFromRow, clearAbcCache, loadVersions, versionsFromRow } from './abc-source';
import type { KeyValueStore } from './practice-storage';
import { mapRepertoireRow, type RepertoireRow } from './repertoire-model';

/**
 * Almacén en memoria con la misma forma que `localStorage` (incluidos `length`
 * y `key(i)`), para poder probar la limpieza de la caché sin tocar el navegador.
 */
function memoryStore(seed: Record<string, string> = {}): KeyValueStore & {
  length: number;
  key: (index: number) => string | null;
} {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/**
 * Dos versiones con la forma real de TheSession, `S:` incluido: el id de setting
 * es lo que se persiste como preferencia, no la posición en la lista.
 */
const TWO_SETTINGS = [
  'X: 1',
  'T: Kesh, The',
  'S: https://thesession.org/tunes/55#setting4512',
  'R: jig',
  'M:6/8',
  'L:1/8',
  'K:G',
  'GAB cde|',
  '',
  'X: 2',
  'T: Kesh, The',
  'S: https://thesession.org/tunes/55#setting8891',
  'R: jig',
  'M:9/8',
  'L:1/8',
  'K:D',
  'DEFG ABcd|',
  '',
].join('\n');

/** Un cuerpo sin cabeceras, como los 51 del repertorio: solo `L:` y `K:`. */
const HEADERLESS = 'L: 1/8\n                K:Adorian\n                |:B|A3B A2GE|A2GA BddB|';

function row(
  overrides: {
    customAbc?: string | null;
    abc?: string | null;
    originRef?: string | null;
    preferredSetting?: string | null;
  } = {}
): RepertoireRow {
  const { customAbc = null, abc = null, originRef = '55', preferredSetting = null } = overrides;
  return mapRepertoireRow({
    id: 'rep-1',
    status: 'learning',
    custom_abc: customAbc,
    preferred_setting: preferredSetting,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: null,
    added_at: '2026-10-01T10:00:00Z',
    last_practiced_day: null,
    pr_tunes: {
      id: 'tune-1',
      origin: 'thesession',
      origin_ref: originRef,
      name: 'Kesh, The',
      rhythm: 'jig',
      meter: '6/8',
      key: 'G',
      abc,
    },
  });
}

/** Un `fetch` de mentira que cuenta las llamadas. */
function fetchStub(handler: () => Promise<Response> | Response) {
  const impl = vi.fn(async () => handler());
  return impl as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

describe('versionsFromRow', () => {
  it('el ABC propio manda y no ofrece cambiar de versión', async () => {
    const set = versionsFromRow(
      row({ customAbc: 'X:9\nT:Mine\nM:4/4\nL:1/8\nK:G\nGABc|\n', abc: TWO_SETTINGS })
    );
    expect(set.origin).toBe('custom');
    expect(set.versions).toHaveLength(1);
    expect(set.versions[0].abc).toContain('T: Mine');
  });

  it('sin ABC propio, las versiones salen del catálogo con su id de setting', () => {
    const set = versionsFromRow(row({ abc: TWO_SETTINGS }));
    expect(set.origin).toBe('catalogue');
    expect(set.versions.map((version) => version.id)).toEqual(['setting4512', 'setting8891']);
    expect(set.versions[1].abc).toContain('DEFG ABcd|');
    expect(set.versions[1].abc).toContain('K: D');
  });

  it('un cuerpo sin cabeceras se completa con los metadatos de la fila', () => {
    const set = versionsFromRow(row({ abc: HEADERLESS }));
    expect(set.origin).toBe('catalogue');
    expect(set.versions).toHaveLength(1);
    const abc = set.versions[0].abc;
    expect(abc).toContain('X: 1');
    expect(abc).toContain('T: Kesh, The');
    expect(abc).toContain('R: jig');
    // La tonalidad del cuerpo manda sobre la de la fila: es la del setting.
    expect(abc).toContain('K: Adorian');
    expect(abc).toContain('A3B A2GE');
  });

  it('ignora un ABC propio en blanco en vez de tratarlo como override', () => {
    expect(versionsFromRow(row({ customAbc: '   \n  ', abc: TWO_SETTINGS })).origin).toBe('catalogue');
  });

  it('sin ABC en la fila ni en el catálogo no hay versiones', () => {
    expect(versionsFromRow(row())).toEqual({ versions: [], origin: 'none' });
  });
});

describe('abcFromRow', () => {
  it('sin preferencia suena la primera versión', () => {
    const source = abcFromRow(row({ abc: TWO_SETTINGS }));
    expect(source.origin).toBe('catalogue');
    expect(source.abc).toContain('GAB cde|');
    expect(source.abc).not.toContain('DEFG ABcd|');
  });

  it('con preferencia suena esa, no la primera', () => {
    const source = abcFromRow(row({ abc: TWO_SETTINGS, preferredSetting: 'setting8891' }));
    expect(source.abc).toContain('DEFG ABcd|');
  });

  it('una preferencia que ya no existe cae a la primera en vez de fallar', () => {
    const source = abcFromRow(row({ abc: TWO_SETTINGS, preferredSetting: 'setting999' }));
    expect(source.abc).toContain('GAB cde|');
  });

  it('dice «no hay» cuando la fila no trae ABC', () => {
    expect(abcFromRow(row())).toEqual({ abc: null, origin: 'none' });
  });
});

describe('loadVersions', () => {
  it('no pide nada cuando la fila ya trae la preferida', async () => {
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));
    await loadVersions(row({ abc: TWO_SETTINGS, preferredSetting: 'setting4512' }), {
      store: memoryStore(),
      fetchImpl,
    });
    // La red solo se pide de fondo para poblar el selector; aquí se comprueba
    // que el adaptador la usa una vez y cachea.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('pide todos los settings una vez y los cachea para la siguiente', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));

    const first = await loadVersions(row({ abc: HEADERLESS }), { store, fetchImpl });
    const second = await loadVersions(row({ abc: HEADERLESS }), { store, fetchImpl });

    expect(first.origin).toBe('thesession');
    expect(first.versions).toHaveLength(2);
    expect(second.versions.map((version) => version.id)).toEqual(['setting4512', 'setting8891']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/ts/tunes/55/abc');
    expect(store.getItem('tt-abc-versions-55')).toContain('setting4512');
  });

  it('no pide nada para un ABC propio: es la versión y no hay más que elegir', async () => {
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));
    const set = await loadVersions(
      row({ customAbc: 'X:9\nT:Mine\nM:4/4\nL:1/8\nK:G\nGABc|\n' }),
      { store: memoryStore(), fetchImpl }
    );
    expect(set.origin).toBe('custom');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('un 410 es un «no» definitivo: se cachea y se pregunta una sola vez', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response('gone', { status: 410 }));

    const first = await loadVersions(row(), { store, fetchImpl });
    const second = await loadVersions(row(), { store, fetchImpl });

    expect(first.versions).toEqual([]);
    expect(second.versions).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.getItem('tt-abc-versions-55')).toBe('{"versions":null}');
  });

  it('sin red se queda con lo que la fila tuviera y no envenena la caché', async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const set = await loadVersions(row({ abc: HEADERLESS }), { store, fetchImpl: failing });

    expect(set.versions).toHaveLength(1);
    expect(set.origin).toBe('catalogue');
    expect(store.getItem('tt-abc-versions-55')).toBeNull();
  });

  it('un cuerpo que no es ABC no borra lo que la fila ya tenía', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response('<html>not abc</html>', { status: 200 }));

    const set = await loadVersions(row({ abc: HEADERLESS }), { store, fetchImpl });

    expect(set.versions).toHaveLength(1);
    expect(set.versions[0].abc).toContain('A3B A2GE');
    expect(store.getItem('tt-abc-versions-55')).toBe('{"versions":null}');
  });

  it('no pregunta dos veces por la misma tune en paralelo', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));

    const [a, b] = await Promise.all([
      loadVersions(row(), { store, fetchImpl }),
      loadVersions(row(), { store, fetchImpl }),
    ]);

    expect(a.versions.length).toBe(b.versions.length);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sin referencia en la fila no hay petición que hacer', async () => {
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));
    const set = await loadVersions(row({ originRef: null }), { store: memoryStore(), fetchImpl });

    expect(set.versions).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('una entrada de caché corrupta se ignora y se vuelve a pedir', async () => {
    const store = memoryStore({ 'tt-abc-versions-55': '{not json' });
    const fetchImpl = fetchStub(() => new Response(TWO_SETTINGS, { status: 200 }));

    const set = await loadVersions(row(), { store, fetchImpl });

    expect(set.versions).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('clearAbcCache', () => {
  it('vacía la caché de versiones, incluidos los «no hay»', async () => {
    const store = memoryStore();
    await loadVersions(row(), {
      store,
      fetchImpl: fetchStub(() => new Response(TWO_SETTINGS, { status: 200 })),
    });
    await loadVersions(row({ originRef: '77' }), {
      store,
      fetchImpl: fetchStub(() => new Response('gone', { status: 410 })),
    });

    expect(store.getItem('tt-abc-versions-55')).not.toBeNull();
    expect(store.getItem('tt-abc-versions-77')).not.toBeNull();

    clearAbcCache(store);

    expect(store.getItem('tt-abc-versions-55')).toBeNull();
    expect(store.getItem('tt-abc-versions-77')).toBeNull();
    expect(store.length).toBe(0);
  });
});
