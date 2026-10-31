import { describe, expect, it, vi } from 'vitest';
import { clearAbcCache, abcFromRow, resolveAbc } from './abc-source';
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

const TWO_SETTINGS = [
  'X:1',
  'T:First',
  'M:4/4',
  'L:1/8',
  'K:D',
  'DEFG ABcd|',
  '',
  'X:2',
  'T:Second',
  'M:6/8',
  'L:1/8',
  'K:G',
  'GAB cde|',
  '',
].join('\n');

function row(overrides: { customAbc?: string | null; abc?: string | null; originRef?: string | null } = {}): RepertoireRow {
  const { customAbc = null, abc = null, originRef = '55' } = overrides;
  return mapRepertoireRow({
    id: 'rep-1',
    status: 'learning',
    custom_abc: customAbc,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: null,
    added_at: '2026-10-01T10:00:00Z',
    last_practiced_at: null,
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

describe('abcFromRow', () => {
  it('prefers the personal ABC over the shared catalogue one', () => {
    const source = abcFromRow(
      row({ customAbc: 'X:9\nT:Mine\nM:4/4\nL:1/8\nK:G\nGABc|\n', abc: TWO_SETTINGS })
    );
    expect(source.origin).toBe('custom');
    expect(source.abc).toContain('T:Mine');
    expect(source.abc).not.toContain('T:First');
  });

  it('falls back to the catalogue ABC when there is no personal one', () => {
    const source = abcFromRow(row({ abc: TWO_SETTINGS }));
    expect(source.origin).toBe('catalogue');
    expect(source.abc).toContain('T:First');
  });

  it('keeps only the first setting of a tune that stores all of them', () => {
    const source = abcFromRow(row({ abc: TWO_SETTINGS }));
    expect(source.abc).toContain('X:1');
    expect(source.abc).toContain('DEFG ABcd|');
    expect(source.abc).not.toContain('X:2');
    expect(source.abc).not.toContain('GAB cde|');
  });

  it('ignores a blank custom ABC instead of treating it as an override', () => {
    const source = abcFromRow(row({ customAbc: '   \n  ', abc: TWO_SETTINGS }));
    expect(source.origin).toBe('catalogue');
  });

  it('says none when neither the row nor the tune carries ABC', () => {
    expect(abcFromRow(row())).toEqual({ abc: null, origin: 'none' });
  });
});

describe('resolveAbc', () => {
  it('returns the row ABC without touching the network', async () => {
    const fetchImpl = fetchStub(() => new Response('X:9\nT:No\n', { status: 200 }));
    const abc = await resolveAbc(row({ abc: TWO_SETTINGS }), { store: memoryStore(), fetchImpl });

    expect(abc).toContain('T:First');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches from The Session and caches the 200 for the next time', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(
      () => new Response('X:1\nT:Fetched\nM:6/8\nL:1/8\nK:G\nGAB|', { status: 200 })
    );

    const first = await resolveAbc(row(), { store, fetchImpl });
    const second = await resolveAbc(row(), { store, fetchImpl });

    expect(first).toContain('T:Fetched');
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://thesession.org/tunes/55/abc');
    expect(store.getItem('tt-abc-55')).toContain('Fetched');
  });

  it('treats a 410 as a final no: null, cached, and asked only once', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response('gone', { status: 410 }));

    const first = await resolveAbc(row(), { store, fetchImpl });
    const second = await resolveAbc(row(), { store, fetchImpl });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.getItem('tt-abc-55')).toBe('{"abc":null}');
  });

  it('does not ask twice when the same tune is requested concurrently', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(
      () => new Response('X:1\nT:Once\nM:4/4\nL:1/8\nK:D\nDEFG|', { status: 200 })
    );

    const [a, b] = await Promise.all([
      resolveAbc(row(), { store, fetchImpl }),
      resolveAbc(row(), { store, fetchImpl }),
    ]);

    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null without throwing on a garbage body, and does not cache it', async () => {
    const store = memoryStore();
    const fetchImpl = fetchStub(() => new Response('<html>not abc</html>', { status: 200 }));

    await expect(resolveAbc(row(), { store, fetchImpl })).resolves.toBeNull();
    expect(store.getItem('tt-abc-55')).toBe('{"abc":null}');
  });

  it('returns null without throwing when the response body cannot be read', async () => {
    const broken = {
      status: 200,
      ok: true,
      text: () => Promise.reject(new Error('network died mid-body')),
    } as unknown as Response;
    const fetchImpl = fetchStub(() => broken);

    await expect(resolveAbc(row(), { store: memoryStore(), fetchImpl })).resolves.toBeNull();
  });

  it('returns null without throwing when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(resolveAbc(row(), { store: memoryStore(), fetchImpl })).resolves.toBeNull();
  });

  it('does not cache a transient failure, so a later try can still work', async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await resolveAbc(row(), { store, fetchImpl: failing });
    expect(store.getItem('tt-abc-55')).toBeNull();
  });

  it('returns null without any request when the tune has no reference at all', async () => {
    const fetchImpl = fetchStub(() => new Response('X:1\n', { status: 200 }));
    const abc = await resolveAbc(row({ originRef: null }), { store: memoryStore(), fetchImpl });

    expect(abc).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ignores a corrupt cache entry instead of rendering it', async () => {
    const store = memoryStore({ 'tt-abc-55': '{not json' });
    const fetchImpl = fetchStub(
      () => new Response('X:1\nT:Fresh\nM:4/4\nL:1/8\nK:D\nDEFG|', { status: 200 })
    );

    const abc = await resolveAbc(row(), { store, fetchImpl });

    expect(abc).toContain('T:Fresh');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('clearAbcCache', () => {
  it('removes every cached ABC, including the negative ones', async () => {
    const store = memoryStore();
    await resolveAbc(row(), {
      store,
      fetchImpl: fetchStub(() => new Response('X:1\nT:One\nM:4/4\nL:1/8\nK:D\nDEFG|', { status: 200 })),
    });
    await resolveAbc(row({ originRef: '77' }), {
      store,
      fetchImpl: fetchStub(() => new Response('gone', { status: 410 })),
    });

    expect(store.getItem('tt-abc-55')).not.toBeNull();
    expect(store.getItem('tt-abc-77')).not.toBeNull();

    clearAbcCache(store);

    expect(store.getItem('tt-abc-55')).toBeNull();
    expect(store.getItem('tt-abc-77')).toBeNull();
    expect(store.length).toBe(0);
  });
});
