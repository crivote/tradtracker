/**
 * Apertura del catálogo en el navegador con SQLite WASM (issue #4).
 *
 * El artefacto se descarga UNA vez y se deserializa en memoria: a partir de ahí
 * cada pulsación del buscador es una consulta local, sin red. Se usa
 * `sqlite3_deserialize` (no OPFS) para no depender de `SharedArrayBuffer` ni de
 * cabeceras COOP/COEP.
 *
 * Toda la lógica de consulta vive en `catalogue.ts` y se prueba contra el
 * artefacto real con `node:sqlite`; aquí solo está el transporte.
 */
import {
  CATALOGUE_BY_ID_CHUNK,
  CATALOGUE_SEARCH_SQL,
  CATALOGUE_STATS_SQL,
  buildCatalogueByIdSql,
  buildFtsMatch,
  mapCatalogueRow,
  orderCatalogue,
  tokenizeQuery,
  type CatalogueEntry,
  type CatalogueRow,
  type CatalogueStats,
} from './catalogue';

const BASE = import.meta.env.BASE_URL ?? '/';
const DB_URL = `${BASE}thesession.db`;
const META_URL = `${BASE}thesession.meta.json`;

/** Candidatos que se piden a SQLite antes de ordenar en JavaScript. */
const CANDIDATE_FLOOR = 40;

export interface CatalogueMeta {
  source_repo: string | null;
  source_commit: string | null;
  source_commit_date: string | null;
  source_commit_subject: string | null;
  copied_at: string;
  bytes: number;
  sha256: string;
  tunes: number | null;
  tunes_with_aliases: number | null;
  columns: string[] | null;
}

interface Catalogue {
  // El paquete no expone tipos estables para el objeto Emscripten; se acota aquí.
  sqlite3: any;
  db: any;
}

let openPromise: Promise<Catalogue> | null = null;

/**
 * Mensaje con la causa medida, no un «algo falló»: si el artefacto no abre, el
 * criterio de la issue pide documentar el error exacto antes de decidir nada.
 */
export class CatalogueError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CatalogueError';
  }
}

async function open(): Promise<Catalogue> {
  let response: Response;
  try {
    response = await fetch(DB_URL);
  } catch (cause) {
    throw new CatalogueError(`The tune catalogue could not be fetched from ${DB_URL}.`, cause);
  }
  if (!response.ok) {
    throw new CatalogueError(
      `The tune catalogue returned HTTP ${response.status} for ${DB_URL}.`
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm');
  const sqlite3: any = await (sqlite3InitModule as any)({ print: () => {}, printErr: () => {} });
  const db = new sqlite3.oo1.DB();

  try {
    sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      sqlite3.wasm.allocFromTypedArray(bytes),
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
    );
  } catch (cause) {
    throw new CatalogueError(
      `SQLite could not open ${DB_URL} (${bytes.length} bytes): ${cause instanceof Error ? cause.message : String(cause)}`,
      cause
    );
  }

  return { sqlite3, db };
}

/** Carga perezosa y compartida: dos llamadas simultáneas abren el fichero una vez. */
export function loadCatalogue(): Promise<Catalogue> {
  if (!openPromise) {
    openPromise = open().catch((cause) => {
      openPromise = null; // permite reintentar tras un fallo de red
      throw cause;
    });
  }
  return openPromise;
}

/** Arranca la descarga sin esperarla (la vista la aprovecha al abrir el buscador). */
export function preloadCatalogue(): Promise<void> {
  return loadCatalogue().then(() => undefined);
}

export async function searchCatalogue(query: string, limit = 15): Promise<CatalogueEntry[]> {
  const tokens = tokenizeQuery(query);
  const match = buildFtsMatch(tokens);
  if (!match) return [];

  const { db } = await loadCatalogue();
  const limitWithSlack = Math.max(CANDIDATE_FLOOR, limit * 4);
  const rows = db.exec({
    sql: CATALOGUE_SEARCH_SQL,
    bind: [match, limitWithSlack],
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as CatalogueRow[];

  return orderCatalogue(rows.map(mapCatalogueRow), tokens, query, limit);
}

/**
 * Compás de una lista de tunes del catálogo (issue #32).
 *
 * El listado del tunebook no trae `meter`; el catálogo sí. Se trocea la
 * consulta para no chocar con el tope de parámetros de SQLite y se devuelve solo
 * lo que existe: los ids ausentes **no** aparecen en el mapa, y quien la usa
 * decide (la importación deja el compás en `null`).
 */
export async function lookupCatalogueMeters(
  tuneIds: number[]
): Promise<Map<number, string | null>> {
  const meters = new Map<number, string | null>();
  const unique = [...new Set(tuneIds)].filter(
    (tuneId) => Number.isInteger(tuneId) && tuneId > 0
  );
  if (unique.length === 0) return meters;

  const { db } = await loadCatalogue();

  for (let start = 0; start < unique.length; start += CATALOGUE_BY_ID_CHUNK) {
    const chunk = unique.slice(start, start + CATALOGUE_BY_ID_CHUNK);
    const rows = db.exec({
      sql: buildCatalogueByIdSql(chunk.length),
      bind: chunk,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as CatalogueRow[];

    for (const row of rows) {
      meters.set(Number(row.tune_id), row.meter == null ? null : String(row.meter));
    }
  }

  return meters;
}

export async function getCatalogueStats(): Promise<CatalogueStats> {
  const { db } = await loadCatalogue();
  const row = (db.exec({
    sql: CATALOGUE_STATS_SQL,
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as CatalogueRow[])[0];

  return {
    tunes: Number(row?.tunes ?? 0),
    withAliases: Number(row?.with_aliases ?? 0),
  };
}

/** Procedencia del artefacto; `null` si el sidecar no está (no rompe la vista). */
export async function getCatalogueMeta(): Promise<CatalogueMeta | null> {
  try {
    const response = await fetch(META_URL);
    if (!response.ok) return null;
    return (await response.json()) as CatalogueMeta;
  } catch {
    return null;
  }
}
