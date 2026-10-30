// @vitest-environment node
/**
 * Búsqueda sobre el artefacto REAL (`public/thesession.db`), no sobre dobles.
 *
 * Se ejecuta la sentencia exacta que usa el navegador (`CATALOGUE_SEARCH_SQL` y
 * `CATALOGUE_STATS_SQL`, importadas del mismo módulo que usa la app) con el
 * SQLite nativo de Node —mismo motor FTS5, distinto transporte—. Lo único que
 * esta suite no cruza es `sqlite-wasm`; eso se comprueba en el navegador.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATALOGUE_SEARCH_SQL,
  CATALOGUE_STATS_SQL,
  aliasExcerpt,
  buildCatalogueByIdSql,
  buildFtsMatch,
  mapCatalogueRow,
  matchedViaAlias,
  orderCatalogue,
  tokenizeQuery,
  type CatalogueEntry,
  type CatalogueRow,
} from './catalogue';

// Vite 5 no lista `node:sqlite` entre los builtins del navegador: se carga por
// require nativo, que sí lo resuelve. Es el único punto donde el test se aparta
// del `import` normal.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

const DB_PATH = fileURLToPath(new URL('../../public/thesession.db', import.meta.url));
const META_PATH = fileURLToPath(new URL('../../public/thesession.meta.json', import.meta.url));

let db: InstanceType<typeof DatabaseSync>;

function search(query: string, limit = 15): CatalogueEntry[] {
  const tokens = tokenizeQuery(query);
  const match = buildFtsMatch(tokens);
  if (!match) return [];
  const rows = db
    .prepare(CATALOGUE_SEARCH_SQL)
    .all(match, Math.max(40, limit * 4)) as unknown as CatalogueRow[];
  return orderCatalogue(rows.map(mapCatalogueRow), tokens, query, limit);
}

beforeAll(() => {
  db = new DatabaseSync(DB_PATH, { readOnly: true });
});

afterAll(() => db.close());

describe('artefacto del catálogo', () => {
  it('coincide con el sidecar de procedencia y no está truncado', () => {
    // El recuento cambia con cada refresco del catálogo: se coteja el artefacto
    // contra el sidecar que escribe `scripts/fetch-catalogue.mjs` (que ya aborta
    // por debajo de 20.000 tunes), no contra una cifra fija que caduca sola.
    const meta = JSON.parse(readFileSync(META_PATH, 'utf8')) as {
      tunes: number;
      tunes_with_aliases: number;
    };
    const row = db.prepare(CATALOGUE_STATS_SQL).get() as Record<string, number>;
    expect(row.tunes).toBe(meta.tunes);
    expect(row.with_aliases).toBe(meta.tunes_with_aliases);
    expect(row.tunes).toBeGreaterThan(22000);
  });

  it('el nombre se devuelve con el id de TheSession, ritmo y compás', () => {
    const [first] = search('butterfly');
    expect(first).toBeDefined();
    expect(first.tuneId).toBe(10);
    expect(first.name).toBe('Butterfly, The');
    expect(first.type).toBe('slip jig');
    expect(first.meter).toBe('9/8');
  });
});

describe('títulos alternativos', () => {
  it('un alias que no está en el nombre encuentra el tune correcto', () => {
    // «Kick The Peeler» solo existe como alias de «Butterfly, The» (id 10).
    const results = search('kick the peeler');
    expect(results[0]?.tuneId).toBe(10);
    expect(matchedViaAlias(results[0], tokenizeQuery('kick the peeler'))).toBe(true);
    expect(aliasExcerpt(results[0], ['peeler'])).toContain('Peeler');
  });

  it('«red admiral» devuelve el tune cuyo alias es ese título', () => {
    const ids = search('red admiral').map((entry) => entry.tuneId);
    expect(ids).toContain(10);
    expect(ids).toContain(16971);
  });

  it('encuentra por alias con diacríticos plegados', () => {
    const tokens = tokenizeQuery('jylhan');
    expect(tokens).toEqual(['jylhan']);
    expect(search('jylhan').map((entry) => entry.tuneId)).toContain(6657);
  });
});

describe('compás por id para la importación (#32)', () => {
  it('resuelve el compás de los ids del tunebook y no devuelve nada para un id ausente', () => {
    const rows = db
      .prepare(buildCatalogueByIdSql(2))
      .all(6970, 1075) as unknown as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => Number(row.tune_id))).toEqual([1075, 6970]);
    for (const row of rows) {
      expect(row.meter).not.toBeNull();
      expect(String(row.meter)).toMatch(/^\d+\/\d+$/);
    }

    expect(db.prepare(buildCatalogueByIdSql(1)).all(99999999)).toHaveLength(0);
  });

  it('la sentencia lleva un marcador por id y exige al menos uno', () => {
    expect(buildCatalogueByIdSql(3)).toBe(
      'SELECT tune_id, meter FROM tunes WHERE tune_id IN (?,?,?)'
    );
    expect(() => buildCatalogueByIdSql(0)).toThrow();
    expect(() => buildCatalogueByIdSql(-2)).toThrow();
  });
});

describe('búsqueda por nombre', () => {
  it('acepta los tokens en cualquier orden', () => {
    expect(search('bar maid behind').map((entry) => entry.tuneId)).toContain(64);
  });

  it('el nombre exacto va primero aunque haya más populares por alias', () => {
    expect(search('butterfly')[0].tuneId).toBe(10);
    expect(search('maid behind the bar')[0].name).toBe('Maid Behind The Bar, The');
  });

  it('no devuelve nada para lo que no existe', () => {
    expect(search('zzzqqq nonexistent')).toEqual([]);
  });

  it('no consulta con una entrada sin tokens útiles', () => {
    expect(search('   ')).toEqual([]);
    expect(search('*')).toEqual([]);
  });
});

describe('rendimiento', () => {
  it('cada búsqueda tarda menos de 100 ms sobre el artefacto completo', () => {
    const queries = ['butterfly', 'red admiral', 'kick the peeler', 'bar maid behind', 'kesh', 'jylhan'];
    const timings: number[] = [];

    for (let round = 0; round < 5; round += 1) {
      for (const query of queries) {
        const started = performance.now();
        search(query);
        timings.push(performance.now() - started);
      }
    }

    const worst = Math.max(...timings);
    const average = timings.reduce((total, value) => total + value, 0) / timings.length;
    expect(timings).toHaveLength(30);
    expect(average).toBeLessThan(100);
    expect(worst).toBeLessThan(100);
  });
});
