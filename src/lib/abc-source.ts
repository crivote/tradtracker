import { splitSettings, type AbcTuneMeta, type AbcVersion } from './abc-settings';
import { displayRhythm, type RepertoireRow } from './repertoire-model';
import type { KeyValueStore } from './practice-storage';

/**
 * De dónde sale el ABC de una fila (#38, versiones en #59).
 *
 * La cadena sigue siendo una sola —**`custom_abc` > `pr_tunes.abc` > The
 * Session**— y su orden no es negociable: un ABC propio es una corrección
 * deliberada del usuario y manda sobre el del catálogo compartido. Lo que
 * cambia en #59 es la unidad: ya no se devuelve «el primer setting», se
 * devuelven **todas las versiones** y el reproductor elige.
 *
 * Tres cosas que este módulo resuelve y que antes no:
 *   1. **Cuerpos sin cabeceras.** 51 filas del repertorio guardan el ABC sin
 *      `X:`/`T:`/`M:`/`R:` (medido: 58 de 478 sin `X:`, 51 con texto). El
 *      reproductor las leía como «no hay ABC». Aquí se completan con los
 *      metadatos de la fila.
 *   2. **El catálogo guarda una sola versión** (420 de 420): para poder elegir
 *      hay que pedirle a TheSession las demás, y eso se hace **una vez por
 *      tune** y se guarda.
 *   3. **La preferencia** viaja en la fila (`preferred_setting`), no en el
 *      navegador: es dato del repertorio y sigue al usuario entre dispositivos.
 *
 * El módulo tiene dos mitades y conviene no mezclarlas:
 *   · `versionsFromRow` es **puro**: solo mira lo que ya viaja en la fila.
 *   · `loadVersions` es el **adaptador** de red y caché, con el `fetch` y el
 *     almacén inyectables, para que los tests no toquen ni la red ni el disco.
 */

/** Las versiones de una fila y su procedencia; una lista vacía es «no hay». */
export interface AbcVersionSet {
  versions: AbcVersion[];
  origin: 'custom' | 'catalogue' | 'thesession' | 'none';
}

/** Lo que `loadVersions` acepta cambiar desde los tests. */
export interface AbcDeps {
  /** Almacén de la caché; `window.localStorage` encaja sin adaptador. */
  store?: KeyValueStore;
  /** El `fetch` de la red; se inyecta para no salir a internet en los tests. */
  fetchImpl?: typeof fetch;
}

/** Prefijo de las claves de caché. No cambiar: hay valores ya guardados. */
const CACHE_PREFIX = 'tt-abc-versions-';

/** Endpoint de The Session, **por el proxy del mismo origen**: devuelve `text/abc`
 * con todos los settings. Directo a `thesession.org` no se puede: no manda CORS
 * (ver `netlify.toml` y la skill, §ABC). */
const THESESSION_ABC_URL = '/ts/tunes';

/** Texto con contenido, o `null`. Un `custom_abc` de espacios no es un override. */
function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Los metadatos con los que se completan las cabeceras que falten. */
function metaOf(row: RepertoireRow): AbcTuneMeta {
  return {
    title: row.tune?.name ?? null,
    rhythm: displayRhythm(row) ?? row.tune?.rhythm ?? null,
    meter: row.tune?.meter ?? null,
    key: row.custom_key ?? row.tune?.key ?? null,
  };
}

/**
 * Las versiones que ya están en la fila, sin red.
 *
 * `custom_abc` es un override deliberado: si existe, **es** la única versión y
 * no se ofrece cambiar (cambiar de versión sería ignorar lo que el dueño
 * escribió). Si no, manda el catálogo, que hoy trae una sola.
 */
export function versionsFromRow(row: RepertoireRow): AbcVersionSet {
  const meta = metaOf(row);

  const custom = text(row.customAbc);
  if (custom) {
    const versions = splitSettings(custom, meta);
    if (versions.length > 0) return { versions, origin: 'custom' };
  }

  const catalogue = text(row.tune?.abc);
  if (catalogue) {
    const versions = splitSettings(catalogue, meta);
    if (versions.length > 0) return { versions, origin: 'catalogue' };
  }

  return { versions: [], origin: 'none' };
}

/**
 * El ABC de la fila sin red: la versión preferida si está entre las que trae, y
 * si no la primera. Es lo que suena al instante, antes de que llegue la red.
 */
export function abcFromRow(row: RepertoireRow): { abc: string | null; origin: AbcVersionSet['origin'] } {
  const set = versionsFromRow(row);
  const chosen = set.versions.find((version) => version.id === row.preferredSetting) ?? set.versions[0];
  return { abc: chosen?.abc ?? null, origin: set.origin };
}

/** Claves que ha tocado esta pestaña: `KeyValueStore` no sabe enumerar. */
const touchedKeys = new Set<string>();

function cacheKey(ref: string): string {
  const key = `${CACHE_PREFIX}${ref}`;
  touchedKeys.add(key);
  return key;
}

/** El almacén por defecto; `null` si el navegador no lo da (modo privado). */
function defaultStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * La entrada guardada: `undefined` = miss, `null` = se preguntó y TheSession no
 * tiene settings, una lista = las versiones. Tolera basura de cualquier forma y
 * nunca lanza: una clave vieja o un JSON roto se tratan como miss.
 */
function readCache(store: KeyValueStore | null, key: string): AbcVersion[] | null | undefined {
  if (!store) return undefined;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const versions = (parsed as { versions?: unknown }).versions;
    if (versions === null) return null;
    if (!Array.isArray(versions)) return undefined;
    const clean = versions.filter((entry): entry is AbcVersion => {
      if (typeof entry !== 'object' || entry === null) return false;
      const candidate = entry as Partial<AbcVersion>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.label === 'string' &&
        typeof candidate.abc === 'string' &&
        candidate.abc.trim().length > 0
      );
    });
    return clean.length > 0 ? clean : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda las versiones (o el «no hay», con `[]`). Una escritura fallida no rompe nada. */
function writeCache(store: KeyValueStore | null, key: string, versions: AbcVersion[] | null): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify({ versions: versions && versions.length > 0 ? versions : null }));
  } catch {
    /* almacenamiento lleno o bloqueado: la caché es un atajo, no un requisito */
  }
}

/** Peticiones en vuelo por referencia: dos toques seguidos no son dos viajes. */
const pending = new Map<string, Promise<AbcVersionSet>>();

/**
 * Todas las versiones de una fila, pidiendo a TheSession **una vez por tune**.
 *
 * El «no» definitivo (410, cuerpo vacío, respuesta que no es ABC) se cachea para
 * no volver a preguntar; un fallo de red pasajero no se cachea y devuelve lo que
 * hubiera en la fila, que es mejor que nada y no envenena la caché.
 */
export async function loadVersions(row: RepertoireRow, deps: AbcDeps = {}): Promise<AbcVersionSet> {
  const local = versionsFromRow(row);
  // Un ABC propio es la versión: no hay nada que elegir ni que pedir.
  if (local.origin === 'custom') return local;

  const ref = text(row.tune?.origin_ref ?? null);
  if (!ref) return local;

  const store = deps.store ?? defaultStore();
  const key = cacheKey(ref);

  const cached = readCache(store, key);
  if (cached !== undefined) {
    if (cached === null) return local.versions.length > 0 ? local : { versions: [], origin: 'none' };
    return { versions: cached, origin: 'thesession' };
  }

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return local;

  const request = (async (): Promise<AbcVersionSet> => {
    try {
      const response = await fetchImpl(`${THESESSION_ABC_URL}/${encodeURIComponent(ref)}/abc`, {
        headers: { Accept: 'text/abc, text/plain;q=0.9' },
      });

      // 410 Gone: el tune ya no está y no va a volver. Este «no» se guarda.
      if (response.status === 410) {
        writeCache(store, key, null);
        return local.versions.length > 0 ? local : { versions: [], origin: 'none' };
      }
      if (!response.ok) return local;

      const body = await response.text();
      const versions = splitSettings(body, metaOf(row));
      if (versions.length === 0) {
        // Un 200 sin música no es un fallo de red: es un «no hay».
        writeCache(store, key, null);
        return local.versions.length > 0 ? local : { versions: [], origin: 'none' };
      }

      writeCache(store, key, versions);
      return { versions, origin: 'thesession' };
    } catch {
      // Red caída, cuerpo ilegible: lo que la fila ya tuviera, sin cachear.
      return local;
    }
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, request);
  return request;
}

/**
 * Vacía la caché de ABC. Se lleva por delante las claves de esta pestaña
 * (`touchedKeys`) y, si el almacén sabe enumerar —`localStorage` sabe—, también
 * las de sesiones anteriores.
 */
export function clearAbcCache(store?: KeyValueStore): void {
  const target = store ?? defaultStore();
  if (!target) {
    touchedKeys.clear();
    return;
  }

  for (const key of touchedKeys) {
    try {
      target.removeItem(key);
    } catch {
      /* nada que hacer: se limpia lo que se pueda */
    }
  }
  touchedKeys.clear();

  const enumerable = target as KeyValueStore & {
    length?: number;
    key?: (index: number) => string | null;
  };
  if (typeof enumerable.length !== 'number' || typeof enumerable.key !== 'function') return;

  const stale: string[] = [];
  for (let index = 0; index < enumerable.length; index += 1) {
    const key = enumerable.key(index);
    if (key && key.startsWith('tt-abc-')) stale.push(key);
  }
  for (const key of stale) {
    try {
      target.removeItem(key);
    } catch {
      /* idem */
    }
  }
}
