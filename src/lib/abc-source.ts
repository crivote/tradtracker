import { firstSetting, hasAbcHeader } from './abc';
import type { KeyValueStore } from './practice-storage';
import type { RepertoireRow } from './repertoire-model';

/**
 * De dónde sale el ABC de una fila (#38).
 *
 * La cadena es una sola: **`custom_abc` > `pr_tunes.abc` > The Session**, y el
 * orden no es negociable — un ABC propio es una corrección deliberada del
 * usuario y manda sobre el del catálogo compartido.
 *
 * El módulo tiene dos mitades y conviene no mezclarlas:
 *   · `abcFromRow` es **puro**: solo mira lo que ya viaja en la fila.
 *   · `resolveAbc` es el **adaptador** de red y caché, con el `fetch` y el
 *     almacén inyectables, para que los tests no toquen ni la red ni el disco.
 *
 * Los dos devuelven el ABC de **un** setting: la columna guarda el texto de
 * todos los settings de la tune y `abcjs` solo sabe dibujar y sonar uno.
 */

/** El ABC de una fila y su procedencia; `origin: 'none'` es «no hay». */
export interface AbcSource {
  abc: string | null;
  origin: 'custom' | 'catalogue' | 'thesession' | 'none';
}

/** Lo que `resolveAbc` acepta cambiar desde los tests. */
export interface AbcDeps {
  /** Almacén de la caché; `window.localStorage` encaja sin adaptador. */
  store?: KeyValueStore;
  /** El `fetch` de la red; se inyecta para no salir a internet en los tests. */
  fetchImpl?: typeof fetch;
}

/** Prefijo de las claves de caché. No cambiar: hay valores ya guardados. */
const CACHE_PREFIX = 'tt-abc-';

/** Endpoint de The Session: devuelve `text/abc` del tune pedido. */
const THESESSION_ABC_URL = 'https://thesession.org/tunes';

/**
 * Texto con contenido, o `null`. Un `custom_abc` de espacios no es un override:
 * es un campo vacío que alguien guardó sin querer.
 */
function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** El primer setting de un texto, o el texto entero si no trae cabecera `X:`. */
function settingOf(abcText: string): string | null {
  const first = firstSetting(abcText);
  if (first) return first;
  // Sin `X:` no hay «setting», pero si tiene las cinco cabeceras mínimas sigue
  // siendo ABC reproducible: no se tira un texto bueno por una cabecera ausente.
  return hasAbcHeader(abcText) ? `${abcText.replace(/\s+$/, '')}\n` : null;
}

/**
 * El ABC que ya está en la fila, sin red. Es lo primero que mira el reproductor
 * al montarse: `pr_tunes.abc` está rellena en 421/421, así que el caso normal es
 * no pedir nada a nadie.
 */
export function abcFromRow(row: RepertoireRow): AbcSource {
  const custom = text(row.customAbc);
  if (custom) {
    const abc = settingOf(custom);
    if (abc) return { abc, origin: 'custom' };
  }

  const catalogue = text(row.tune?.abc);
  if (catalogue) {
    const abc = settingOf(catalogue);
    if (abc) return { abc, origin: 'catalogue' };
  }

  return { abc: null, origin: 'none' };
}

/**
 * Claves que ha tocado esta pestaña. `KeyValueStore` no sabe enumerar (no tiene
 * `length` ni `key(i)`), así que `clearAbcCache` necesita esta lista para poder
 * limpiar también un almacén inyectado.
 */
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
 * La entrada guardada: `undefined` = no hay nada utilizable (miss), `null` = se
 * preguntó y no había ABC, una cadena = el ABC.
 *
 * Tolera basura de cualquier forma: una clave vieja, un JSON roto o un objeto
 * con otra forma se tratan como miss y se vuelve a preguntar. Nunca lanza.
 */
function readCache(store: KeyValueStore | null, key: string): string | null | undefined {
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
    const abc = (parsed as { abc?: unknown }).abc;
    if (abc === null) return null;
    if (typeof abc === 'string') return abc.trim().length > 0 ? abc : null;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Guarda el ABC (o el «no hay», con `abc: null`). Una escritura fallida no rompe nada. */
function writeCache(store: KeyValueStore | null, key: string, abc: string | null): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify({ abc }));
  } catch {
    /* almacenamiento lleno o bloqueado: la caché es un atajo, no un requisito */
  }
}

/** Peticiones en vuelo por referencia: dos toques seguidos no son dos viajes. */
const pending = new Map<string, Promise<string | null>>();

/**
 * El ABC de una fila, resolviendo la red **solo si hace falta**.
 *
 * Devuelve `null` cuando no hay ABC y ese «no» es definitivo (410 Gone, cuerpo
 * vacío, respuesta que no es ABC): se cachea para no volver a preguntar. Un
 * fallo de red pasajero también devuelve `null` —el reproductor dice «no ABC»,
 * nunca un error crudo— pero **no** se cachea: mañana puede haber red.
 *
 * La caché vive en `localStorage` (`tt-abc-<ref>`), es decir, sobrevive a la
 * recarga y no vuelve a molestar a The Session por un tune que ya se pidió.
 */
export async function resolveAbc(row: RepertoireRow, deps: AbcDeps = {}): Promise<string | null> {
  const local = abcFromRow(row);
  if (local.abc) return local.abc;

  const ref = text(row.tune?.origin_ref ?? null);
  if (!ref) return null;

  const store = deps.store ?? defaultStore();
  const key = cacheKey(ref);

  const cached = readCache(store, key);
  if (cached !== undefined) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;

  const request = (async (): Promise<string | null> => {
    try {
      const response = await fetchImpl(`${THESESSION_ABC_URL}/${encodeURIComponent(ref)}/abc`, {
        headers: { Accept: 'text/abc, text/plain;q=0.9' },
      });

      // 410 Gone: el tune ya no está y no va a volver. Este «no» se guarda.
      if (response.status === 410) {
        writeCache(store, key, null);
        return null;
      }
      if (!response.ok) return null;

      const body = await response.text();
      const abc = text(body) ? settingOf(body) : null;
      if (!abc) {
        // Un 200 con el cuerpo vacío no es un fallo de red: es un «no hay».
        writeCache(store, key, null);
        return null;
      }

      writeCache(store, key, abc);
      return abc;
    } catch {
      // Red caída, cuerpo ilegible, `text()` que revienta: «no hay», sin cachear.
      return null;
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
    if (key && key.startsWith(CACHE_PREFIX)) stale.push(key);
  }
  for (const key of stale) {
    try {
      target.removeItem(key);
    } catch {
      /* idem */
    }
  }
}
