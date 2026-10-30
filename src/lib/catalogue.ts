/**
 * Catálogo de tunes: construcción de la búsqueda y ordenación de resultados.
 *
 * Módulo PURO a propósito. El artefacto `public/thesession.db` (22.775 tunes,
 * FTS5 sobre `tunes_search`) se abre con SQLite WASM en `catalogue-db.ts`;
 * aquí solo viven las funciones que se pueden probar sin navegador —y la
 * sentencia SQL exacta que se ejecuta contra el artefacto real.
 *
 * Los títulos alternativos (columna `aliases` de `tunes_search`) son de primera
 * clase: cada token del usuario se busca en `name` O en `aliases`, así que
 * «kick the peeler» encuentra el tune cuyo nombre es «Butterfly, The». El
 * `tune_id` que devuelve la consulta es el del tune, no el del alias: es el
 * que se guarda como `origin_ref` en `pr_tunes` (issue #4).
 */
import { normalizeTitle } from './format';

export interface CatalogueEntry {
  tuneId: number;
  name: string;
  type: string | null;
  meter: string | null;
  popularity: number;
  aliases: string | null;
}

export interface CatalogueStats {
  tunes: number;
  withAliases: number;
}

/** Fila cruda que devuelve sqlite-wasm (`rowMode: 'object'`). */
export type CatalogueRow = Record<string, unknown>;

/**
 * Sentencia del buscador. `tunes_search MATCH ?` recibe el resultado de
 * `buildFtsMatch`; el `LIMIT` pide más filas de las que se muestran porque la
 * ordenación fina (nombre exacto, prefijo, alias) se hace en JavaScript.
 */
export const CATALOGUE_SEARCH_SQL = `
  SELECT ts.tune_id AS tune_id,
         t.name AS name,
         t.type AS type,
         t.meter AS meter,
         t.popularity_score AS popularity_score,
         ts.aliases AS aliases
  FROM tunes_search ts
  JOIN tunes t ON t.tune_id = CAST(ts.tune_id AS INTEGER)
  WHERE tunes_search MATCH ?
  ORDER BY t.popularity_score DESC, length(t.name) ASC
  LIMIT ?
`;

export const CATALOGUE_STATS_SQL = `
  SELECT (SELECT count(*) FROM tunes) AS tunes,
         (SELECT count(*) FROM tunes_search
           WHERE aliases IS NOT NULL AND aliases <> '') AS with_aliases
`;

/**
 * Tunes por tanda en la consulta por id. SQLite tiene un tope de parámetros
 * ligados por sentencia; 400 deja aire de sobra y hace tandas pequeñas.
 */
export const CATALOGUE_BY_ID_CHUNK = 400;

/**
 * Sentencia del compás para una lista de ids (`IN (?,?,…)`). La usa la
 * importación del tunebook (issue #32): el listado del API no trae `meter` y el
 * catálogo lo tiene para todo lo medido.
 */
export function buildCatalogueByIdSql(count: number): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildCatalogueByIdSql needs a positive whole number of ids, got ${count}.`);
  }
  const placeholders = Array.from({ length: count }, () => '?').join(',');
  return `SELECT tune_id, meter FROM tunes WHERE tune_id IN (${placeholders})`;
}

/** Máximo de tokens que se aceptan de una consulta: acota la expresión FTS. */
const MAX_TOKENS = 8;

const ARTICLE_PREFIX = /^(the|a|an|na)\s+/;

/**
 * Normaliza para comparar: sin acentos, minúsculas y comillas tipográficas
 * unificadas. El tokenizador de FTS5 (`unicode61`) quita diacríticos, así que
 * la comparación en JavaScript tiene que hacer lo mismo o «jylhän» no casaría
 * con lo que el índice guardó.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u2018\u2019\u02bc`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parte la consulta del usuario en tokens seguros para FTS5. Se descarta todo
 * lo que no sea letra o dígito, así que no hay forma de colar operadores
 * (`*`, `"`, `NEAR`, `AND`…). Los fragmentos de una letra se descartan porque
 * salen de los apóstrofos («morrison's» → `morrison`, `s`) y un prefijo `s*`
 * arrastra medio catálogo.
 */
export function tokenizeQuery(query: string): string[] {
  const tokens = foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
    if (unique.length === MAX_TOKENS) break;
  }
  return unique;
}

/**
 * Expresión FTS5: cada token debe aparecer en el nombre O en los alias.
 * Devuelve `null` cuando no queda ningún token útil (no se consulta).
 */
export function buildFtsMatch(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  return tokens.map((token) => `(name:${token}* OR aliases:${token}*)`).join(' AND ');
}

/** Nombre sin artículo delante, para que «butterfly» case con «Butterfly, The». */
function bareName(name: string): string {
  return foldText(normalizeTitle(name)).replace(ARTICLE_PREFIX, '');
}

function coversAll(haystack: string, tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

export function mapCatalogueRow(row: CatalogueRow): CatalogueEntry {
  return {
    tuneId: Number(row.tune_id),
    name: String(row.name ?? ''),
    type: row.type == null ? null : String(row.type),
    meter: row.meter == null ? null : String(row.meter),
    popularity: Number(row.popularity_score ?? 0),
    aliases: row.aliases == null || row.aliases === '' ? null : String(row.aliases),
  };
}

/**
 * Posición de un resultado. Menor es mejor:
 * 0 el nombre es exactamente lo buscado · 1 empieza por lo buscado ·
 * 2 el nombre contiene todos los tokens · 3 solo casa por un título alternativo.
 */
export function rankEntry(entry: CatalogueEntry, tokens: string[], query: string): number {
  const foldedQuery = foldText(query);
  const bareQuery = foldedQuery.replace(ARTICLE_PREFIX, '');
  const name = foldText(entry.name);
  const bare = bareName(entry.name);
  const aliases = foldText(entry.aliases ?? '');

  if (name === foldedQuery || bare === bareQuery) return 0;
  if (bare.startsWith(bareQuery) || name.startsWith(foldedQuery)) return 1;
  if (coversAll(bare, tokens) || coversAll(name, tokens)) return 2;
  if (coversAll(aliases, tokens)) return 3;
  return 4;
}

/**
 * Ordena los candidatos que ya devolvió SQLite. El desempate final por longitud
 * y nombre hace el resultado estable —sin él, dos tunes con la misma
 * popularidad podrían intercambiarse entre pulsaciones.
 */
export function orderCatalogue(
  entries: CatalogueEntry[],
  tokens: string[],
  query: string,
  limit: number
): CatalogueEntry[] {
  return [...entries]
    .sort((left, right) => {
      const rank = rankEntry(left, tokens, query) - rankEntry(right, tokens, query);
      if (rank !== 0) return rank;
      if (right.popularity !== left.popularity) return right.popularity - left.popularity;
      if (left.name.length !== right.name.length) return left.name.length - right.name.length;
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

/**
 * ¿El resultado aparece solo por un título alternativo? Sirve para enseñar el
 * alias junto al nombre: sin esa pista, ver «Butterfly, The» tras buscar «red
 * admiral» parece un error del buscador.
 */
export function matchedViaAlias(entry: CatalogueEntry, tokens: string[]): boolean {
  const name = foldText(entry.name);
  if (coversAll(name, tokens)) return false;
  return entry.aliases !== null && coversAll(foldText(entry.aliases), tokens);
}

/**
 * Recorte del alias que casó, con contexto. Los alias del artefacto vienen
 * concatenados sin separador («… Red Admiral Butterfly, The Red Monarch …»),
 * así que no se pueden partir en una lista: se localiza la palabra por sus
 * desplazamientos en el texto original y se enseña una ventana alrededor.
 */
export function aliasExcerpt(entry: CatalogueEntry, tokens: string[], context = 18): string | null {
  const aliases = entry.aliases;
  if (!aliases || tokens.length === 0) return null;

  const words = [...aliases.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)];
  const hit = words.find((word) => {
    const folded = foldText(word[0]);
    return tokens.some((token) => folded.startsWith(token));
  });
  if (!hit || hit.index === undefined) return null;

  const start = Math.max(0, hit.index - context);
  const end = Math.min(aliases.length, hit.index + hit[0].length + context);

  // El recorte cae donde caiga: se ajusta a límites de palabra para no enseñar
  // «Admira» donde ponía «Admiral».
  let from = start;
  if (from > 0) {
    const space = aliases.indexOf(' ', from);
    if (space !== -1 && space < hit.index) from = space + 1;
  }
  let to = end;
  if (to < aliases.length) {
    const space = aliases.indexOf(' ', to);
    if (space !== -1) to = space;
  }

  const core = aliases.slice(from, to).replace(/\s+/g, ' ').trim();
  if (core.length === 0) return null;
  return `${from > 0 ? '… ' : ''}${core}${to < aliases.length ? ' …' : ''}`;
}
