// @vitest-environment node
/**
 * Parseo y plan de la importación del tunebook (issue #32).
 *
 * Los fixtures son la respuesta REAL del servicio medida el 2026-10-30, con sus
 * rarezas incluidas: números que llegan como texto, `added: ""` en una cuenta
 * antigua y tunes sin nombre. Sin red: esto es módulo puro.
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_MAX_PAGES,
  SESSION_PER_PAGE,
  dedupeTunebook,
  importPlan,
  parseMemberId,
  parseMemberSearch,
  parseTunebookPage,
  repertoireRowsFor,
  tuneRowsFor,
  type SessionTune,
} from './thesession-import';

/** Payload tal cual lo devuelve `GET /members/99727/tunebook?format=json&perpage=50&page=1`. */
const TUNEBOOK_PAYLOAD = {
  format: 'json',
  perpage: '50',
  pages: 9,
  page: 1,
  total: 421,
  member: { id: 99727, name: 'victor gomez', url: 'https://thesession.org/members/99727' },
  tunes: [
    {
      id: 6970,
      name: "The 72nd Highlanders' Farewell To Aberdeen",
      url: 'https://thesession.org/tunes/6970',
      date: '2007-03-19 14:42:48',
      type: 'march',
      added: '2022-11-16 17:58:44',
    },
    {
      id: 1075,
      name: 'The Britches Full Of Stitches',
      url: 'https://thesession.org/tunes/1075',
      date: '2002-10-24 04:13:37',
      type: 'polka',
      added: '2022-09-24 21:04:25',
    },
  ],
};

function tune(overrides: Partial<SessionTune> = {}): SessionTune {
  return { tuneId: 1, name: 'Tune', rhythm: 'reel', addedAt: null, ...overrides };
}

describe('parseTunebookPage', () => {
  it('lee id, nombre, ritmo y fecha de alta de cada tune', () => {
    const page = parseTunebookPage(TUNEBOOK_PAYLOAD);

    expect(page.tunes).toEqual([
      {
        tuneId: 6970,
        name: "The 72nd Highlanders' Farewell To Aberdeen",
        rhythm: 'march',
        addedAt: '2022-11-16T17:58:44Z',
      },
      {
        tuneId: 1075,
        name: 'The Britches Full Of Stitches',
        rhythm: 'polka',
        addedAt: '2022-09-24T21:04:25Z',
      },
    ]);
  });

  it('normaliza a número la paginación aunque llegue como texto', () => {
    const page = parseTunebookPage(TUNEBOOK_PAYLOAD);
    expect(page.page).toBe(1);
    expect(page.pages).toBe(9);
    expect(page.total).toBe(421);
  });

  it('acepta la paginación numérica y completa lo que falte', () => {
    const page = parseTunebookPage({ page: '2', pages: 3, tunes: [] });
    expect(page.page).toBe(2);
    expect(page.pages).toBe(3);
    expect(page.total).toBe(0);
  });

  it('descarta el tune sin nombre y sigue con el resto', () => {
    const page = parseTunebookPage({
      page: 1,
      pages: 1,
      total: 3,
      tunes: [
        { id: 1, name: '', type: 'reel', added: '2022-01-01 00:00:00' },
        { id: 2, type: 'jig', added: '2022-01-01 00:00:00' },
        { id: 3, name: 'Keep Me', type: 'jig', added: '2022-01-01 00:00:00' },
      ],
    });

    expect(page.tunes.map((entry) => entry.tuneId)).toEqual([3]);
  });

  it('deja el ritmo en null cuando el tipo viene vacío', () => {
    const [only] = parseTunebookPage({
      tunes: [{ id: 42, name: 'Sin Tipo', type: '', added: '' }],
    }).tunes;

    expect(only.rhythm).toBeNull();
  });

  it('deja la fecha en null cuando added viene vacío (cuenta antigua)', () => {
    const [only] = parseTunebookPage({
      tunes: [{ id: 42, name: 'Cuenta Antigua', type: 'reel', added: '' }],
    }).tunes;

    expect(only.addedAt).toBeNull();
  });

  it('deja la fecha en null cuando added no es una fecha válida', () => {
    const page = parseTunebookPage({
      tunes: [
        { id: 1, name: 'Basura', type: 'reel', added: 'ayer' },
        { id: 2, name: 'Imposible', type: 'reel', added: '2022-02-31 10:00:00' },
      ],
    });

    expect(page.tunes.map((entry) => entry.addedAt)).toEqual([null, null]);
  });

  it('lanza si el payload no trae la lista de tunes', () => {
    expect(() => parseTunebookPage({ format: 'json', error: '410: Gone' })).toThrow(/tunes/);
    expect(() => parseTunebookPage(null)).toThrow(Error);
  });

  it('un tunebook vacío no es un error', () => {
    const page = parseTunebookPage({ pages: 0, page: 1, total: 0, tunes: [] });
    expect(page.tunes).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe('parseMemberId', () => {
  it('acepta el número pelado, con espacios alrededor', () => {
    expect(parseMemberId('99727')).toBe(99727);
    expect(parseMemberId(' 99727 ')).toBe(99727);
  });

  it('acepta la URL de la ficha y la del tunebook', () => {
    expect(parseMemberId('https://thesession.org/members/99727')).toBe(99727);
    expect(parseMemberId('https://thesession.org/members/99727/tunebook')).toBe(99727);
  });

  it('acepta la ruta relativa', () => {
    expect(parseMemberId('members/99727')).toBe(99727);
  });

  it('devuelve null para nombres, cero, negativos y basura', () => {
    expect(parseMemberId('crivote')).toBeNull();
    expect(parseMemberId('https://thesession.org/members/crivote/tunebook')).toBeNull();
    expect(parseMemberId('0')).toBeNull();
    expect(parseMemberId('-5')).toBeNull();
    expect(parseMemberId('members/0')).toBeNull();
    expect(parseMemberId('   ')).toBeNull();
    expect(parseMemberId('99727abc')).toBeNull();
  });
});

describe('parseMemberSearch', () => {
  it('lee los miembros que devuelve el buscador', () => {
    const members = parseMemberSearch({
      q: 'crivote',
      total: 1,
      members: [
        {
          id: 99727,
          name: 'victor gomez',
          url: 'https://thesession.org/members/99727',
          location: { city: 'Madrid', country: 'Spain' },
          date: '',
          bio: 'Bodhrán y flauta.',
        },
      ],
    });

    expect(members).toEqual([{ id: 99727, name: 'victor gomez', bio: 'Bodhrán y flauta.' }]);
  });

  it('deja la bio en null cuando viene vacía y aguanta payloads raros', () => {
    expect(parseMemberSearch({ members: [{ id: 1, name: 'Uno', bio: '' }] })).toEqual([
      { id: 1, name: 'Uno', bio: null },
    ]);
    expect(parseMemberSearch({ q: 'nadie', members: [] })).toEqual([]);
    expect(parseMemberSearch(null)).toEqual([]);
  });
});

describe('dedupeTunebook', () => {
  it('se queda con la primera aparición y conserva el orden', () => {
    const unique = dedupeTunebook([
      tune({ tuneId: 3, name: 'Tercero' }),
      tune({ tuneId: 1, name: 'Primero' }),
      tune({ tuneId: 3, name: 'Tercero repetido' }),
      tune({ tuneId: 2, name: 'Segundo' }),
    ]);

    expect(unique.map((entry) => entry.name)).toEqual(['Tercero', 'Primero', 'Segundo']);
  });
});

describe('importPlan', () => {
  it('sin solapes, todo va a añadir', () => {
    const tunes = [tune({ tuneId: 10 }), tune({ tuneId: 20 })];
    const plan = importPlan(tunes, []);

    expect(plan.toAdd.map((entry) => entry.tuneId)).toEqual([10, 20]);
    expect(plan.alreadyPresent).toEqual([]);
  });

  it('separa lo que ya está por origin_ref en texto y conserva el orden', () => {
    const tunes = [tune({ tuneId: 10 }), tune({ tuneId: 20 }), tune({ tuneId: 30 })];
    const plan = importPlan(tunes, new Set(['30', '10']));

    expect(plan.alreadyPresent.map((entry) => entry.tuneId)).toEqual([10, 30]);
    expect(plan.toAdd.map((entry) => entry.tuneId)).toEqual([20]);
  });

  it('acepta cualquier iterable de referencias', () => {
    const plan = importPlan([tune({ tuneId: 7 })], ['7']);
    expect(plan.toAdd).toEqual([]);
    expect(plan.alreadyPresent).toHaveLength(1);
  });
});

describe('tuneRowsFor', () => {
  it('compone la fila de pr_tunes con origin_ref en texto y el compás del catálogo', () => {
    const rows = tuneRowsFor([tune({ tuneId: 6970, name: '72nd', rhythm: 'march' })], new Map([[6970, '4/4']]));

    expect(rows).toEqual([
      { origin: 'thesession', origin_ref: '6970', name: '72nd', rhythm: 'march', meter: '4/4' },
    ]);
  });

  it('deja el compás en null cuando el id no está en el catálogo', () => {
    const [row] = tuneRowsFor([tune({ tuneId: 999999 })], new Map([[6970, '4/4']]));

    expect(row.meter).toBeNull();
    expect(row.origin_ref).toBe('999999');
  });

  it('no pone created_by: lo exige la RLS y lo rellena el llamador', () => {
    const [row] = tuneRowsFor([tune()], new Map());
    expect(Object.keys(row)).toEqual(['origin', 'origin_ref', 'name', 'rhythm', 'meter']);
  });
});

describe('repertoireRowsFor', () => {
  it('cruza por origin_ref en texto y arrastra la fecha de alta', () => {
    const rows = repertoireRowsFor(
      [tune({ tuneId: 6970, addedAt: '2022-11-16T17:58:44Z' })],
      new Map([['6970', 'uuid-6970']]),
      'learning'
    );

    expect(rows).toEqual([
      { tune_id: 'uuid-6970', status: 'learning', added_at: '2022-11-16T17:58:44Z' },
    ]);
  });

  it('omite la clave added_at cuando la fecha falta, para no anular el default now()', () => {
    const [row] = repertoireRowsFor(
      [tune({ tuneId: 42, addedAt: null })],
      new Map([['42', 'uuid-42']]),
      'learning'
    );

    expect(row).toEqual({ tune_id: 'uuid-42', status: 'learning' });
    expect('added_at' in row).toBe(false);
  });

  it('omite la fila cuando falta el uuid del tune recién creado', () => {
    const rows = repertoireRowsFor(
      [tune({ tuneId: 1 }), tune({ tuneId: 2 })],
      new Map([['2', 'uuid-2']]),
      'learning'
    );

    expect(rows).toEqual([{ tune_id: 'uuid-2', status: 'learning' }]);
  });
});

describe('constantes de la importación', () => {
  it('pide páginas de 50 y no pasa de 40 (2.000 tunes)', () => {
    expect(SESSION_PER_PAGE).toBe(50);
    expect(SESSION_MAX_PAGES).toBe(40);
    expect(SESSION_PER_PAGE * SESSION_MAX_PAGES).toBe(2000);
  });
});
