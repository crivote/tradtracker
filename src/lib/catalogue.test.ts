import { describe, expect, it } from 'vitest';
import {
  aliasExcerpt,
  buildFtsMatch,
  foldText,
  mapCatalogueRow,
  matchedViaAlias,
  orderCatalogue,
  rankEntry,
  tokenizeQuery,
  type CatalogueEntry,
} from './catalogue';

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    tuneId: 1,
    name: 'Untitled',
    type: 'reel',
    meter: '4/4',
    popularity: 0,
    aliases: null,
    ...overrides,
  };
}

describe('foldText', () => {
  it('quita diacríticos, como hace el tokenizador unicode61 de FTS5', () => {
    expect(foldText('Jylhän Polska')).toBe('jylhan polska');
  });

  it('unifica comillas tipográficas y apóstrofos', () => {
    expect(foldText('Morrison\u2019s')).toBe("morrison's");
    expect(foldText('Morrison`s')).toBe("morrison's");
  });

  it('colapsa espacios y recorta', () => {
    expect(foldText('  The   Kesh ')).toBe('the kesh');
  });
});

describe('tokenizeQuery', () => {
  it('parte por lo buscado y descarta los fragmentos de una letra', () => {
    // El apóstrofo parte «morrison's» en «morrison» + «s»; un prefijo s* sobra.
    expect(tokenizeQuery("Morrison's")).toEqual(['morrison']);
  });

  it('elimina la sintaxis de FTS5 en lugar de dejar que se interprete', () => {
    expect(tokenizeQuery('butterfly*) OR name:kesh')).toEqual(['butterfly', 'or', 'name', 'kesh']);
  });

  it('quita duplicados y no devuelve nada con una consulta vacía', () => {
    expect(tokenizeQuery('the the kesh')).toEqual(['the', 'kesh']);
    expect(tokenizeQuery('   ')).toEqual([]);
    expect(tokenizeQuery('*')).toEqual([]);
  });

  it('acota el número de tokens', () => {
    expect(tokenizeQuery('uno dos tres cuatro cinco seis siete ocho nueve diez')).toHaveLength(8);
  });
});

describe('buildFtsMatch', () => {
  it('busca cada token en el nombre Y en los títulos alternativos', () => {
    expect(buildFtsMatch(['red', 'admiral'])).toBe(
      '(name:red* OR aliases:red*) AND (name:admiral* OR aliases:admiral*)'
    );
  });

  it('no construye consulta sin tokens', () => {
    expect(buildFtsMatch([])).toBeNull();
  });
});

describe('mapCatalogueRow', () => {
  it('convierte la fila de SQLite y trata los alias vacíos como ausentes', () => {
    expect(
      mapCatalogueRow({
        tune_id: 10,
        name: 'Butterfly, The',
        type: 'slip jig',
        meter: '9/8',
        popularity_score: 99,
        aliases: '',
      })
    ).toEqual({
      tuneId: 10,
      name: 'Butterfly, The',
      type: 'slip jig',
      meter: '9/8',
      popularity: 99,
      aliases: null,
    });
  });
});

describe('rankEntry', () => {
  const tokens = ['butterfly'];

  it('el nombre exacto gana aunque el tune sea impopular', () => {
    const exact = entry({ name: 'Butterfly, The', popularity: 1 });
    const prefix = entry({ name: 'Butterfly Tree, The', popularity: 99 });
    expect(rankEntry(exact, tokens, 'butterfly')).toBe(0);
    expect(rankEntry(prefix, tokens, 'butterfly')).toBe(1);
  });

  it('distingue el acierto por nombre del acierto solo por alias', () => {
    const byName = entry({ name: 'Annika\u2019s Butterfly' });
    const byAlias = entry({ name: 'Butterfly, The', aliases: 'Kick The Peeler' });
    expect(rankEntry(byName, tokens, 'butterfly')).toBe(2);
    expect(rankEntry(byAlias, ['peeler'], 'peeler')).toBe(3);
  });

  it('reconoce el nombre con el artículo delante o detrás', () => {
    const tune = entry({ name: 'Kesh, The' });
    expect(rankEntry(tune, ['kesh'], 'the kesh')).toBe(0);
    expect(rankEntry(tune, ['kesh'], 'kesh')).toBe(0);
  });
});

describe('orderCatalogue', () => {
  it('ordena por posición, luego popularidad y recorta al límite', () => {
    const entries = [
      entry({ tuneId: 1, name: 'Butterfly Road To Galway, The', popularity: 63 }),
      entry({ tuneId: 2, name: 'Butterfly, The', popularity: 99 }),
      entry({ tuneId: 3, name: 'Butterfly Tree, The', popularity: 0 }),
      entry({ tuneId: 4, name: 'Ballinahulla Butterfly, The', popularity: 58 }),
    ];
    const ordered = orderCatalogue(entries, ['butterfly'], 'butterfly', 3);
    expect(ordered.map((item) => item.tuneId)).toEqual([2, 1, 3]);
  });

  it('es estable entre dos tunes idénticos en posición y popularidad', () => {
    const entries = [
      entry({ tuneId: 7, name: 'Butterfly Reel' }),
      entry({ tuneId: 8, name: 'Butterfly Jig' }),
    ];
    const first = orderCatalogue(entries, ['butterfly'], 'butterfly', 5).map((item) => item.tuneId);
    const second = orderCatalogue([...entries].reverse(), ['butterfly'], 'butterfly', 5).map(
      (item) => item.tuneId
    );
    expect(first).toEqual(second);
  });
});

describe('matchedViaAlias', () => {
  it('solo es cierto cuando el nombre no cubre la búsqueda', () => {
    const tune = entry({ name: 'Butterfly, The', aliases: "Barney's Goat Kick The Peeler" });
    expect(matchedViaAlias(tune, ['butterfly'])).toBe(false);
    expect(matchedViaAlias(tune, ['peeler'])).toBe(true);
    expect(matchedViaAlias(entry({ name: 'Butterfly, The' }), ['peeler'])).toBe(false);
  });
});

describe('aliasExcerpt', () => {
  const tune = entry({
    name: 'Butterfly, The',
    aliases: "Barney's Goat Eitil Im Im Ag Eitilt Kick The Peeler Red Admiral Butterfly, The",
  });

  it('recorta alrededor de la palabra que casó, con elipsis si hay contexto', () => {
    expect(aliasExcerpt(tune, ['peeler'], 10)).toBe('… Kick The Peeler Red Admiral …');
  });

  it('devuelve null sin aliases o cuando el token no está en ellos', () => {
    expect(aliasExcerpt(entry({ aliases: null }), ['peeler'])).toBeNull();
    expect(aliasExcerpt(tune, ['zzz'])).toBeNull();
  });

  it('encuentra un alias con diacríticos por su forma plegada', () => {
    const accented = entry({ aliases: 'Jylhän Polska' });
    expect(aliasExcerpt(accented, ['jylhan'])).toContain('Jylhän Polska');
  });
});
