import { describe, expect, it } from 'vitest';
import {
  BANDS,
  bandFor,
  capForColumns,
  capRows,
  cardKey,
  collationKey,
  compareStaleness,
  displayKey,
  displayRhythm,
  displayTitle,
  groupIntoBands,
  mapRepertoireRow,
  mapStatsRow,
  matchesQuery,
  overrideFields,
  parseScope,
  parseViewMode,
  placeholderInitials,
  practiceRecency,
  practiceSummary,
  qualityDots,
  rhythmOptions,
  searchRepertoire,
  sortRepertoire,
  shelvedCount,
  stalenessColor,
  stalenessDays,
  stalenessIntensity,
  stalenessTag,
  stalenessTitle,
  statusCounts,
  visibleShelved,
  type RepertoireRow,
  type RepertoireStats,
  type TuneStatus,
} from './repertoire-model';

const tune = {
  id: 'tune-uuid',
  origin: 'thesession',
  origin_ref: '55',
  name: 'Kesh, The',
  rhythm: 'jig',
  meter: '6/8',
  key: null,
  abc: null,
};

const baseRow = {
  id: 'repertoire-uuid',
  status: 'to_learn',
  rating: null,
  custom_title: null,
  custom_rhythm: null,
  custom_key: null,
  notes: null,
  added_at: '2026-10-28T12:00:00Z',
  last_practiced_at: null,
};

describe('mapRepertoireRow', () => {
  it('accepts the embedded tune as an object (many-to-one)', () => {
    const row = mapRepertoireRow({ ...baseRow, pr_tunes: tune });
    expect(row.tune.name).toBe('Kesh, The');
    expect(row.status).toBe('to_learn');
    expect(row.rating).toBeNull();
  });

  it('accepts the embedded tune as an array (to-one returned as list)', () => {
    const row = mapRepertoireRow({ ...baseRow, pr_tunes: [tune] });
    expect(row.tune.id).toBe('tune-uuid');
  });

  it('fails loudly when the tune is missing instead of rendering a blank row', () => {
    expect(() => mapRepertoireRow({ ...baseRow, pr_tunes: null })).toThrow(/without its tune/);
  });

  it('carries the row’s own ABC through as customAbc (#38)', () => {
    const row = mapRepertoireRow({
      ...baseRow,
      custom_abc: 'X:1\nT:Mine\nM:4/4\nL:1/8\nK:G\nGABc|\n',
      pr_tunes: tune,
    });
    expect(row.customAbc).toBe('X:1\nT:Mine\nM:4/4\nL:1/8\nK:G\nGABc|\n');
  });

  it('maps a null or missing custom_abc to null instead of undefined', () => {
    expect(mapRepertoireRow({ ...baseRow, custom_abc: null, pr_tunes: tune }).customAbc).toBeNull();
    expect(mapRepertoireRow({ ...baseRow, pr_tunes: tune }).customAbc).toBeNull();
  });

  it('does not take a non-string custom_abc as an ABC', () => {
    expect(mapRepertoireRow({ ...baseRow, custom_abc: 42, pr_tunes: tune }).customAbc).toBeNull();
  });
});

describe('display helpers', () => {
  const item = mapRepertoireRow({ ...baseRow, pr_tunes: tune });

  it('falls back to the shared tune and normalizes the title', () => {
    expect(displayTitle(item)).toBe('The Kesh');
    expect(displayRhythm(item)).toBe('jig');
    expect(displayKey(item)).toBe('—');
  });

  it('prefers the personal overrides', () => {
    const overridden: RepertoireRow = {
      ...item,
      custom_title: 'The Kesh (session version)',
      custom_rhythm: 'slide',
      custom_key: 'G',
    };
    expect(displayTitle(overridden)).toBe('The Kesh (session version)');
    expect(displayRhythm(overridden)).toBe('slide');
    expect(displayKey(overridden)).toBe('G');
  });
});

// --- Orden (issue #7): cuatro criterios deterministas ----------------------

/** Fila de prueba: identidad y tune a medida; lo demás toma valores neutros. */
function makeRow(input: {
  id: string;
  name?: string;
  custom_title?: string | null;
  custom_rhythm?: string | null;
  rhythm?: string | null;
  rating?: number | null;
  added_at?: string;
  last_practiced_at?: string | null;
  status?: TuneStatus;
  shelved?: boolean;
  key?: string | null;
  stats?: RepertoireStats;
}): RepertoireRow {
  const { name, key, rhythm, stats, ...overrides } = input;
  return mapRepertoireRow(
    {
      ...baseRow,
      added_at: '2026-06-01T12:00:00Z',
      ...overrides,
      pr_tunes: {
        ...tune,
        name: name ?? tune.name,
        rhythm: rhythm === undefined ? tune.rhythm : rhythm,
        key: key === undefined ? tune.key : key,
      },
    },
    stats ?? null
  );
}

describe('collationKey', () => {
  it('lowercases and strips diacritics so comparisons stay comparable', () => {
    expect(collationKey('Ángel')).toBe('angel');
    expect(collationKey('Niña')).toBe('nina');
    expect(collationKey('Óró Sé do Bheatha Abhaile')).toBe('oro se do bheatha abhaile');
  });
});

describe('sortRepertoire', () => {
  it('urgency puts never-practiced rows first, then the ones practiced longest ago', () => {
    const never = makeRow({ id: 'n1', name: 'Fresh Jig' });
    const old = makeRow({ id: 'old', name: 'Old Reel', last_practiced_at: '2026-01-10T10:00:00Z' });
    const recent = makeRow({
      id: 'recent',
      name: 'Recent Reel',
      last_practiced_at: '2026-10-20T10:00:00Z',
    });
    const sorted = sortRepertoire([recent, never, old], 'urgency');
    expect(sorted.map((row) => row.id)).toEqual(['n1', 'old', 'recent']);
  });

  it('urgency orders the never-practiced ones by title, not by added date', () => {
    const laterAdded = makeRow({ id: 'b', name: 'Never Beta', added_at: '2026-09-01T00:00:00Z' });
    const earlierAdded = makeRow({ id: 'a', name: 'Never Alpha', added_at: '2026-02-01T00:00:00Z' });
    // Si el criterio fuera la fecha de alta, «Beta» saldría primera (desc).
    const sorted = sortRepertoire([laterAdded, earlierAdded], 'urgency');
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('alphabetical ignores case and accents', () => {
    const angel = makeRow({ id: 'angel', name: 'Ángel' });
    const nube = makeRow({ id: 'nube', name: 'Nube' });
    const oro = makeRow({ id: 'oro', name: 'oro' });
    // Sin normalizar, «Á» (U+00C1) ordenaría después de la «O».
    const sorted = sortRepertoire([oro, angel, nube], 'alphabetical');
    expect(sorted.map((row) => row.id)).toEqual(['angel', 'nube', 'oro']);
  });

  it('alphabetical follows the displayed title, so a custom override wins', () => {
    const overridden = makeRow({ id: 'x', name: 'Zzz', custom_title: 'Aaa' });
    const plain = makeRow({ id: 'y', name: 'Bbb' });
    const sorted = sortRepertoire([plain, overridden], 'alphabetical');
    expect(sorted.map((row) => row.id)).toEqual(['x', 'y']);
  });

  it('equal keys resolve by id, the same way regardless of the input order', () => {
    const first = makeRow({ id: 't-1', name: 'banshee' });
    const second = makeRow({ id: 't-2', name: 'Banshee' });
    expect(sortRepertoire([first, second], 'alphabetical').map((row) => row.id)).toEqual([
      't-1',
      't-2',
    ]);
    expect(sortRepertoire([second, first], 'alphabetical').map((row) => row.id)).toEqual([
      't-1',
      't-2',
    ]);
  });

  it('added puts the most recently added rows first', () => {
    const old = makeRow({ id: 'old', name: 'Old', added_at: '2026-01-01T00:00:00Z' });
    const mid = makeRow({ id: 'mid', name: 'Mid', added_at: '2026-06-01T00:00:00Z' });
    const fresh = makeRow({ id: 'fresh', name: 'Fresh', added_at: '2026-10-01T00:00:00Z' });
    const sorted = sortRepertoire([old, fresh, mid], 'added');
    expect(sorted.map((row) => row.id)).toEqual(['fresh', 'mid', 'old']);
  });

  it('rating sorts descending with the unrated ones last', () => {
    const high = makeRow({ id: 'high', name: 'High', rating: 5 });
    const mid = makeRow({ id: 'mid', name: 'Mid', rating: 3 });
    const unrated = makeRow({ id: 'un', name: 'Unrated' });
    const sorted = sortRepertoire([unrated, high, mid], 'rating');
    expect(sorted.map((row) => row.id)).toEqual(['high', 'mid', 'un']);
  });

  it('rating ties resolve by title', () => {
    const alpha = makeRow({ id: 'a', name: 'Alpha', rating: 4 });
    const zed = makeRow({ id: 'z', name: 'Zed', rating: 4 });
    const sorted = sortRepertoire([zed, alpha], 'rating');
    expect(sorted.map((row) => row.id)).toEqual(['a', 'z']);
  });

  it('never mutates the input list', () => {
    const first = makeRow({ id: 'a', name: 'Nube' });
    const second = makeRow({ id: 'b', name: 'Ángel' });
    const input = Object.freeze([first, second]);
    const sorted = sortRepertoire(input, 'alphabetical');
    expect(sorted.map((row) => row.id)).toEqual(['b', 'a']);
    expect([...input].map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('parseViewMode', () => {
  it('defaults to the grid view; only an explicit «table» opts out', () => {
    expect(parseViewMode('grid')).toBe('grid');
    expect(parseViewMode('table')).toBe('table');
    expect(parseViewMode('junk')).toBe('grid');
    expect(parseViewMode(null)).toBe('grid');
  });
});

// --- Recencia, iniciales y overrides (#7, corte 2) -------------------------

/** Instante de referencia fijo: ninguna prueba de fechas depende del reloj real. */
const NOW = Date.parse('2026-10-28T12:00:00Z');

describe('practiceRecency', () => {
  it('says «Never practiced» when there is no timestamp', () => {
    expect(practiceRecency(makeRow({ id: 'never' }), NOW)).toEqual({
      days: null,
      label: 'Never practiced',
    });
  });

  it('says «Never practiced» for an unparsable timestamp', () => {
    const row = makeRow({ id: 'broken', last_practiced_at: 'ayer' });
    expect(practiceRecency(row, NOW).label).toBe('Never practiced');
    expect(practiceRecency(row, NOW).days).toBeNull();
  });

  it('says «Practiced today» for anything within the last day', () => {
    const row = makeRow({ id: 'today', last_practiced_at: '2026-10-28T08:00:00Z' });
    expect(practiceRecency(row, NOW)).toEqual({ days: 0, label: 'Practiced today' });
  });

  it('says «1 day ago» in the singular', () => {
    const row = makeRow({ id: 'yesterday', last_practiced_at: '2026-10-27T08:00:00Z' });
    expect(practiceRecency(row, NOW)).toEqual({ days: 1, label: '1 day ago' });
  });

  it('says «N days ago» in the plural', () => {
    const row = makeRow({ id: 'week', last_practiced_at: '2026-10-21T08:00:00Z' });
    expect(practiceRecency(row, NOW)).toEqual({ days: 7, label: '7 days ago' });
  });

  it('counts a future timestamp as today instead of a negative number', () => {
    const row = makeRow({ id: 'future', last_practiced_at: '2026-12-24T08:00:00Z' });
    expect(practiceRecency(row, NOW)).toEqual({ days: 0, label: 'Practiced today' });
  });
});

describe('placeholderInitials', () => {
  it('takes the initials of the displayed title, so the inverted article counts first', () => {
    // «Kesh, The» se muestra como «The Kesh»: las iniciales son TK, no KT.
    expect(placeholderInitials(makeRow({ id: 'kesh' }))).toBe('TK');
  });

  it('uses a single letter for a one-word title and uppercases it', () => {
    expect(placeholderInitials(makeRow({ id: 'morrison', name: "morrison's" }))).toBe('M');
  });

  it('stops at two letters', () => {
    expect(
      placeholderInitials(makeRow({ id: 'long', name: 'Out On The Ocean' }))
    ).toBe('OO');
  });

  it('prefers the custom title, which is what the card shows', () => {
    const row = makeRow({ id: 'custom', name: 'Zzz', custom_title: 'Silver Spear' });
    expect(placeholderInitials(row)).toBe('SS');
  });

  it('falls back to «?» when the title has no letters at all', () => {
    expect(placeholderInitials(makeRow({ id: 'nothing', name: '« »' }))).toBe('?');
    expect(placeholderInitials(makeRow({ id: 'blank', name: '' }))).toBe('?');
  });
});

describe('overrideFields', () => {
  it('marks nothing when every value comes from the shared tune', () => {
    expect(overrideFields(makeRow({ id: 'plain' }))).toEqual({
      title: false,
      rhythm: false,
      key: false,
    });
  });

  it('does not count an empty or blank override as an override', () => {
    const row: RepertoireRow = {
      ...makeRow({ id: 'blank' }),
      custom_title: '   ',
      custom_rhythm: '',
      custom_key: null,
    };
    expect(overrideFields(row)).toEqual({ title: false, rhythm: false, key: false });
  });

  it('marks each field that has its own text', () => {
    const row: RepertoireRow = {
      ...makeRow({ id: 'custom' }),
      custom_title: 'The Kesh (session version)',
      custom_rhythm: 'slide',
      custom_key: 'G',
    };
    expect(overrideFields(row)).toEqual({ title: true, rhythm: true, key: true });
  });

  it('marks only the fields that were overridden', () => {
    const row: RepertoireRow = { ...makeRow({ id: 'key-only' }), custom_key: 'D' };
    expect(overrideFields(row)).toEqual({ title: false, rhythm: false, key: true });
  });
});

// --- Home del repertorio (#29): peldaños, gradiente, medidor y topes --------

/** Instante ISO de hace `days` días respecto a NOW. */
function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

describe('mapRepertoireRow con los agregados de la vista (#29)', () => {
  it('acepta la fila de la vista y convierte el numeric que llega como cadena', () => {
    // PostgREST entrega `numeric` como cadena: 4,25 llega «4.25».
    const stats = mapStatsRow({
      practice_count: 8,
      avg_quality: '4.25',
      days_since_last_practice: 12,
    });
    expect(stats).toEqual({ practice_count: 8, avg_quality: 4.25, days_since_last_practice: 12 });

    const row = mapRepertoireRow({ ...baseRow, pr_tunes: tune }, stats);
    expect(row.practice_count).toBe(8);
    expect(row.avg_quality).toBe(4.25);
    expect(row.days_since_last_practice).toBe(12);
  });

  it('sin vista deja los tres agregados en null: no hay dato, no hay cero', () => {
    const row = mapRepertoireRow({ ...baseRow, pr_tunes: tune });
    expect(row.practice_count).toBeNull();
    expect(row.avg_quality).toBeNull();
    expect(row.days_since_last_practice).toBeNull();
  });

  it('conserva el cero de una fila sin ensayos y el null de una sin valorar', () => {
    const row = mapRepertoireRow(
      { ...baseRow, pr_tunes: tune },
      { practice_count: 0, avg_quality: null, days_since_last_practice: null }
    );
    expect(row.practice_count).toBe(0);
    expect(row.avg_quality).toBeNull();
  });

  it('lee la bandera de aparcada y los peldaños nuevos', () => {
    const row = mapRepertoireRow({
      ...baseRow,
      status: 'solo_ready',
      shelved: true,
      pr_tunes: tune,
    });
    expect(row.status).toBe('solo_ready');
    expect(row.shelved).toBe(true);
    expect(mapRepertoireRow({ ...baseRow, pr_tunes: tune }).shelved).toBe(false);
  });

  it('lee la bandera de favorita de F6 (no toca el rating)', () => {
    const marked = mapRepertoireRow({ ...baseRow, favorite: true, rating: 4, pr_tunes: tune });
    expect(marked.favorite).toBe(true);
    expect(marked.rating).toBe(4);

    const unmarked = mapRepertoireRow({ ...baseRow, favorite: false, rating: 4, pr_tunes: tune });
    expect(unmarked.favorite).toBe(false);
    expect(unmarked.rating).toBe(4);
  });

  it('cae a no favorita cuando la fila es anterior a la migración 008', () => {
    const row = mapRepertoireRow({ ...baseRow, pr_tunes: tune });
    expect(row.favorite).toBe(false);
    expect(mapRepertoireRow({ ...baseRow, favorite: null, pr_tunes: tune }).favorite).toBe(false);
    expect(mapRepertoireRow({ ...baseRow, favorite: undefined, pr_tunes: tune }).favorite).toBe(false);
  });

  it('mapStatsRow tolera basura sin romper la pantalla', () => {
    expect(mapStatsRow(undefined)).toEqual({
      practice_count: null,
      avg_quality: null,
      days_since_last_practice: null,
    });
    expect(mapStatsRow({ practice_count: 'no', avg_quality: '', days_since_last_practice: null })).toEqual({
      practice_count: null,
      avg_quality: null,
      days_since_last_practice: null,
    });
  });
});

describe('bandas de la escalera (#29)', () => {
  it('son cuatro, en orden de capacidad, con su definición y su peldaño', () => {
    expect(BANDS.map((band) => band.status)).toEqual([
      'to_learn',
      'learning',
      'playing_along',
      'solo_ready',
    ]);
    expect(BANDS.map((band) => band.label)).toEqual([
      'To learn',
      'Learning',
      'Playing along',
      'Solo-ready',
    ]);
    expect(BANDS.map((band) => band.rung)).toEqual([1, 2, 3, 4]);
    // Una sola carta para todas las filas: la banda no lleva densidad.
    for (const band of BANDS) {
      expect('density' in band).toBe(false);
    }
    for (const band of BANDS) {
      expect(band.definition.length).toBeGreaterThan(10);
    }
    expect(BANDS[0].definition).toBe('Want to learn it. Not started.');
    expect(BANDS[3].definition).toBe("If someone asks for a tune, this is one you’d give them.");
  });

  it('parseScope acepta los cuatro peldaños y el cajón, y rechaza lo demás', () => {
    for (const band of BANDS) {
      expect(parseScope(band.status)).toBe(band.status);
    }
    expect(parseScope('shelved')).toBe('shelved');
    expect(parseScope(undefined)).toBeNull();
    expect(parseScope('nueva')).toBeNull();
    expect(parseScope(['playing_along'])).toBeNull();
    expect(parseScope(42)).toBeNull();
  });

  it('bandFor devuelve la banda del estado y no rompe con un valor desconocido', () => {
    expect(bandFor('playing_along').rung).toBe(3);
    expect(bandFor('nueva' as TuneStatus).status).toBe('to_learn');
  });

  it('statusCounts cuenta por peldaño y deja las cuatro claves siempre', () => {
    const rows = [
      makeRow({ id: 'a', status: 'to_learn' }),
      makeRow({ id: 'b', status: 'learning' }),
      makeRow({ id: 'c', status: 'learning' }),
      makeRow({ id: 'd', status: 'solo_ready' }),
    ];
    expect(statusCounts(rows)).toEqual({
      to_learn: 1,
      learning: 2,
      playing_along: 0,
      solo_ready: 1,
    });
    expect(statusCounts([])).toEqual({
      to_learn: 0,
      learning: 0,
      playing_along: 0,
      solo_ready: 0,
    });
  });

  it('shelvedCount cierra la cuenta de la cabecera: bandas + cajón = repertorio', () => {
    const rows = [
      makeRow({ id: 'a', status: 'to_learn' }),
      makeRow({ id: 'b', status: 'learning', shelved: true }),
      makeRow({ id: 'c', status: 'solo_ready', shelved: true }),
    ];
    const counts = statusCounts(rows);
    const enBandas = counts.to_learn + counts.learning + counts.playing_along + counts.solo_ready;

    expect(shelvedCount(rows)).toBe(2);
    expect(enBandas + shelvedCount(rows)).toBe(rows.length);
    expect(shelvedCount([])).toBe(0);
    expect(shelvedCount([makeRow({ id: 'd', shelved: false })])).toBe(0);
  });
});

describe('staleness: días, etiqueta y gradiente (#29)', () => {
  it('sale de last_practiced_at con el instante inyectado', () => {
    expect(stalenessDays(makeRow({ id: 'never' }), NOW)).toBeNull();
    expect(stalenessDays(makeRow({ id: 'x', last_practiced_at: daysAgo(41) }), NOW)).toBe(41);
  });

  it('usa los días de la vista solo si falta la fecha en la fila', () => {
    const row = makeRow({
      id: 'x',
      stats: { practice_count: 1, avg_quality: 4, days_since_last_practice: 9 },
    });
    expect(stalenessDays(row, NOW)).toBe(9);
  });

  it('la etiqueta es never / today / 1 day / N days', () => {
    expect(stalenessTag(null)).toEqual({ days: null, value: 'never', unit: null });
    expect(stalenessTag(0)).toEqual({ days: 0, value: 'today', unit: null });
    expect(stalenessTag(1)).toEqual({ days: 1, value: '1', unit: 'day' });
    expect(stalenessTag(41)).toEqual({ days: 41, value: '41', unit: 'days' });
  });

  it('el title del tag dice lo mismo con palabras', () => {
    expect(stalenessTitle(stalenessTag(null))).toBe('Never practiced');
    expect(stalenessTitle(stalenessTag(0))).toBe('Practiced today');
    expect(stalenessTitle(stalenessTag(1))).toBe('Last practiced 1 day ago');
    expect(stalenessTitle(stalenessTag(41))).toBe('Last practiced 41 days ago');
  });

  it('la escala es raíz sobre 90 días, no lineal', () => {
    expect(stalenessIntensity(0)).toBe(0);
    expect(stalenessIntensity(3)).toBeCloseTo(Math.sqrt(3 / 90), 10);
    expect(stalenessIntensity(90)).toBe(1);
    // Más allá de 90 no aporta: satura.
    expect(stalenessIntensity(400)).toBe(1);
    expect(stalenessIntensity(null)).toBe(1);
  });

  it('el color del tag a 3 días es rgb(235,214,197) y a 90 es rgb(186,95,62)', () => {
    expect(stalenessColor(3).background).toBe('rgb(235,214,197)');
    expect(stalenessColor(90).background).toBe('rgb(186,95,62)');
    // Los extremos: papel recién tocada, teja a los 90 y en «never».
    expect(stalenessColor(0).background).toBe('rgb(246,240,227)');
    expect(stalenessColor(null).background).toBe('rgb(186,95,62)');
    expect(stalenessColor(400).background).toBe('rgb(186,95,62)');
  });

  it('el texto pasa a blanco solo cuando el fondo ya es oscuro', () => {
    expect(stalenessColor(3).foreground).toBe('#3c3428');
    expect(stalenessColor(90).foreground).toBe('#ffffff');
    expect(stalenessColor(null).foreground).toBe('#ffffff');
  });
});

describe('medidor de calidad (#29)', () => {
  it('dibuja medio punto: 2,5 son dos llenos, uno a medias y dos vacíos', () => {
    expect(qualityDots(2.5)).toEqual(['on', 'on', 'half', 'off', 'off']);
  });

  it('redondea a los umbrales del boceto (0,75 y 0,25)', () => {
    expect(qualityDots(5)).toEqual(['on', 'on', 'on', 'on', 'on']);
    expect(qualityDots(4.2)).toEqual(['on', 'on', 'on', 'on', 'off']);
    expect(qualityDots(1)).toEqual(['on', 'off', 'off', 'off', 'off']);
    expect(qualityDots(0.5)).toEqual(['half', 'off', 'off', 'off', 'off']);
    expect(qualityDots(null)).toEqual([]);
  });

  it('«4.2 avg · 8 practices», con el singular bien puesto', () => {
    expect(
      practiceSummary(
        makeRow({ id: 'x', stats: { practice_count: 8, avg_quality: 4.2, days_since_last_practice: 2 } })
      )
    ).toEqual({ dots: qualityDots(4.2), text: '4.2 avg · 8 practices', empty: false });

    expect(
      practiceSummary(
        makeRow({ id: 'y', stats: { practice_count: 1, avg_quality: 5, days_since_last_practice: 2 } })
      ).text
    ).toBe('5.0 avg · 1 practice');
  });

  it('sin ensayos dice «no sessions yet» y no pinta medidor', () => {
    const none = practiceSummary(
      makeRow({ id: 'x', stats: { practice_count: 0, avg_quality: null, days_since_last_practice: null } })
    );
    expect(none).toEqual({ dots: [], text: 'no sessions yet', empty: true });
  });

  it('sin vista de agregados dice lo mismo que sin ensayos: no se estima', () => {
    expect(practiceSummary(makeRow({ id: 'x' })).text).toBe('no sessions yet');
  });

  it('con ensayos sin puntuar cuenta los ensayos y no dibuja cinco aros vacíos', () => {
    const unrated = practiceSummary(
      makeRow({ id: 'x', stats: { practice_count: 2, avg_quality: null, days_since_last_practice: 1 } })
    );
    expect(unrated.dots).toEqual([]);
    expect(unrated.text).toBe('2 practices');
    expect(unrated.empty).toBe(true);
  });
});

describe('groupIntoBands y orden por staleness (#29)', () => {
  it('devuelve las cuatro bandas en orden de escalera, aunque estén vacías', () => {
    const groups = groupIntoBands([], NOW);
    expect(groups.map((group) => group.band.status)).toEqual([
      'to_learn',
      'learning',
      'playing_along',
      'solo_ready',
    ]);
    expect(groups.every((group) => group.rows.length === 0)).toBe(true);
  });

  it('dentro de cada banda, nunca tocada primero y después días descendentes', () => {
    const rows = [
      makeRow({ id: 'recent', name: 'Recent', status: 'learning', last_practiced_at: daysAgo(2) }),
      makeRow({ id: 'never-b', name: 'Never B', status: 'learning' }),
      makeRow({ id: 'old', name: 'Old', status: 'learning', last_practiced_at: daysAgo(90) }),
      makeRow({ id: 'never-a', name: 'Never A', status: 'learning' }),
      makeRow({ id: 'mid', name: 'Mid', status: 'learning', last_practiced_at: daysAgo(41) }),
    ];
    const [toLearn, learning] = groupIntoBands(rows, NOW);
    expect(toLearn.rows).toEqual([]);
    expect(learning.rows.map((row) => row.id)).toEqual([
      'never-a',
      'never-b',
      'old',
      'mid',
      'recent',
    ]);
  });

  it('el empate de staleness se rompe por título sin diacríticos (collationKey)', () => {
    const rows = [
      makeRow({ id: 'z', name: 'Zed', status: 'to_learn', last_practiced_at: daysAgo(10) }),
      makeRow({ id: 'a', name: 'Ángel', status: 'to_learn', last_practiced_at: daysAgo(10) }),
      makeRow({ id: 'n', name: 'nube', status: 'to_learn', last_practiced_at: daysAgo(10) }),
    ];
    expect(groupIntoBands(rows, NOW)[0].rows.map((row) => row.id)).toEqual(['a', 'n', 'z']);
  });

  it('no muta las filas de entrada y no se cuela ningún estado ajeno', () => {
    const rows = Object.freeze([
      makeRow({ id: 'a', status: 'to_learn' }),
      makeRow({ id: 'b', status: 'nueva' as TuneStatus }),
    ]);
    const groups = groupIntoBands(rows, NOW);
    expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(1);
    expect([...rows].map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('compareStaleness es un comparador total: mismo resultado en cualquier orden', () => {
    const a = makeRow({ id: 'a', name: 'Alpha', last_practiced_at: daysAgo(5) });
    const b = makeRow({ id: 'b', name: 'Beta', last_practiced_at: daysAgo(5) });
    expect(compareStaleness(a, b, NOW)).toBeLessThan(0);
    expect(compareStaleness(b, a, NOW)).toBeGreaterThan(0);
    expect(compareStaleness(a, a, NOW)).toBe(0);
  });
});

describe('coincidencia por título y topes (#29)', () => {
  const rows = [
    makeRow({ id: 'a', name: 'Banshee, The', status: 'to_learn' }),
    makeRow({ id: 'b', name: 'Ángel', status: 'learning' }),
    makeRow({ id: 'c', name: 'Cooley’s', status: 'playing_along' }),
  ];

  it('busca por título mostrado, sin mayúsculas ni diacríticos', () => {
    // El título se muestra normalizado («Banshee, The» → «The Banshee»).
    expect(matchesQuery(rows[0], 'the banshee')).toBe(true);
    expect(matchesQuery(rows[0], 'banshee the')).toBe(false);
    expect(matchesQuery(rows[0], 'banshee')).toBe(true);
    expect(matchesQuery(rows[0], '')).toBe(true);
    expect(matchesQuery(rows[1], 'ANGEL')).toBe(true);
  });

  it('el título personal manda en la búsqueda, igual que en la carta', () => {
    const custom = makeRow({ id: 'x', name: 'Zzz', custom_title: 'Silver Spear' });
    expect(matchesQuery(custom, 'silver')).toBe(true);
    expect(matchesQuery(custom, 'zzz')).toBe(false);
  });

  it('el tope son dos filas sobre las columnas reales', () => {
    expect(capForColumns(4)).toBe(8);
    expect(capForColumns(3)).toBe(6);
    expect(capForColumns(6)).toBe(12);
    expect(capForColumns(1)).toBe(2);
    expect(capForColumns(0)).toBe(0);
    expect(capForColumns(-2)).toBe(0);
    expect(capForColumns(Number.NaN)).toBe(0);
  });

  it('capRows corta sin mutar y con Infinity no corta nada', () => {
    const list = [1, 2, 3, 4, 5];
    expect(capRows(list, 2)).toEqual([1, 2]);
    expect(capRows(list, 0)).toEqual([]);
    expect(capRows(list, Number.POSITIVE_INFINITY)).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5]);
  });
});

// --- Búsqueda del repertorio (#9) ------------------------------------------

describe('searchRepertoire (#9)', () => {
  const rows = [
    makeRow({ id: 'cooley', name: 'Cooley’s Reel', rhythm: 'reel', status: 'playing_along' }),
    makeRow({ id: 'banshee', name: 'Banshee, The', rhythm: 'jig', status: 'to_learn' }),
    makeRow({ id: 'angel', name: 'Ángel', rhythm: 'reel', status: 'learning' }),
    makeRow({ id: 'sligo', name: 'Sligo Creek', rhythm: 'reel', status: 'solo_ready', shelved: true }),
    makeRow({ id: 'morning', name: 'Morning Dew', rhythm: 'reel', status: 'solo_ready' }),
  ];

  it('sin texto y sin ritmo devuelve la lista vacía: la vista arranca sin cartas', () => {
    expect(searchRepertoire(rows, '', null)).toEqual([]);
    expect(searchRepertoire(rows, '   ', null)).toEqual([]);
    expect(searchRepertoire([], '', null)).toEqual([]);
  });

  it('busca por coincidencia parcial del título mostrado', () => {
    expect(searchRepertoire(rows, 'coo', null).map((row) => row.id)).toEqual(['cooley']);
    // «Banshee, The» se muestra como «The Banshee».
    expect(searchRepertoire(rows, 'the banshee', null).map((row) => row.id)).toEqual(['banshee']);
    expect(searchRepertoire(rows, 'banshee the', null)).toEqual([]);
  });

  it('no distingue mayúsculas ni acentos', () => {
    expect(searchRepertoire(rows, 'ANGEL', null).map((row) => row.id)).toEqual(['angel']);
  });

  it('ordena alfabéticamente por título mostrado, no por el orden de llegada', () => {
    // `banshee` llega antes que `angel`; la consulta ordena, no respeta la entrada.
    expect(searchRepertoire(rows, 'an', null).map((row) => row.id)).toEqual(['angel', 'banshee']);
  });

  it('solo con ritmo, sin texto, lista todas las de ese ritmo', () => {
    expect(searchRepertoire(rows, '', 'reel').map((row) => row.id)).toEqual([
      'angel', // Ángel
      'cooley', // Cooley’s Reel
      'morning', // Morning Dew
      'sligo', // Sligo Creek
    ]);
  });

  it('combina el texto y el ritmo: los dos criterios se suman', () => {
    expect(searchRepertoire(rows, 'e', 'jig').map((row) => row.id)).toEqual(['banshee']);
    expect(searchRepertoire(rows, 'sligo', 'jig')).toEqual([]);
  });

  it('el ritmo filtra sin distinguir mayúsculas, igual que lo deduplica el selector', () => {
    // `rhythmOptions` junta «Reel» y «reel» en una sola opción; si el filtro
    // comparase el texto exacto, elegir esa opción escondería la mitad de las
    // filas —y el recuento no cuadraría con lo que ofrece el selector—.
    const mixed = [
      makeRow({ id: 'a', name: 'A', rhythm: 'Reel' }),
      makeRow({ id: 'b', name: 'B', rhythm: 'reel' }),
      makeRow({ id: 'c', name: 'C', rhythm: 'Reel', custom_rhythm: 'REEL' }),
    ];
    expect(rhythmOptions(mixed)).toEqual(['Reel']);
    expect(searchRepertoire(mixed, '', 'Reel').map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(searchRepertoire(mixed, '', 'reel').map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('cruza todos los peldaños y también las aparcadas', () => {
    // Una fila por peldaño, la última en el cajón: todas responden a la consulta.
    expect(searchRepertoire(rows, 'e', null).map((row) => row.id)).toContain('sligo');
    expect(rows.find((row) => row.id === 'sligo')!.shelved).toBe(true);
  });
});

describe('rhythmOptions (#9)', () => {
  it('devuelve los ritmos distintos, sin duplicados por acentos y ordenados', () => {
    const rows = [
      makeRow({ id: 'a', name: 'A', rhythm: 'Reel' }),
      makeRow({ id: 'b', name: 'B', rhythm: 'reel' }),
      makeRow({ id: 'c', name: 'C', rhythm: 'jig' }),
      makeRow({ id: 'd', name: 'D', rhythm: 'Áir' }),
      makeRow({ id: 'e', name: 'E', rhythm: 'reel' }),
    ];
    // El primero visto manda en el texto; la clave sin diacríticos deduplica.
    expect(rhythmOptions(rows)).toEqual(['Áir', 'jig', 'Reel']);
  });

  it('toma el ritmo personal cuando lo hay', () => {
    const rows = [makeRow({ id: 'a', name: 'A', rhythm: 'jig', custom_rhythm: 'slide' })];
    expect(rhythmOptions(rows)).toEqual(['slide']);
  });

  it('sin filas no hay opciones', () => {
    expect(rhythmOptions([])).toEqual([]);
  });
});

describe('aparcadas (#11): fuera de las bandas y del recuento', () => {
  const rows = [
    makeRow({ id: 'work', name: 'Working', status: 'learning' }),
    makeRow({ id: 'shelf', name: 'Shelved One', status: 'learning', shelved: true }),
    makeRow({ id: 'shelf-never', name: 'Shelved Never', status: 'to_learn', shelved: true }),
  ];

  it('groupIntoBands deja fuera las aparcadas aunque su peldaño sea el de la banda', () => {
    const groups = groupIntoBands(rows, NOW);
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      [],
      ['work'],
      [],
      [],
    ]);
  });

  it('con todas aparcadas las cuatro bandas quedan vacías', () => {
    const allShelved = [
      makeRow({ id: 'a', status: 'to_learn', shelved: true }),
      makeRow({ id: 'b', status: 'solo_ready', shelved: true }),
    ];
    const groups = groupIntoBands(allShelved, NOW);
    expect(groups.every((group) => group.rows.length === 0)).toBe(true);
    // Siguen siendo cuatro: la escalera se pinta aunque no haya nada en ella.
    expect(groups.length).toBe(4);
  });

  it('statusCounts no las cuenta, para que la cabecera cuadre con las bandas', () => {
    expect(statusCounts(rows)).toEqual({
      to_learn: 0,
      learning: 1,
      playing_along: 0,
      solo_ready: 0,
    });
    // Sin aparcadas el recuento es el de siempre.
    expect(statusCounts([makeRow({ id: 'x', status: 'solo_ready' })])).toEqual({
      to_learn: 0,
      learning: 0,
      playing_along: 0,
      solo_ready: 1,
    });
  });
});

describe('visibleShelved: el cajón del final (#11)', () => {
  const shelved = [
    makeRow({ id: 'old', name: 'Old Reel', status: 'playing_along', shelved: true, last_practiced_at: daysAgo(80) }),
    makeRow({ id: 'never', name: 'Never Jig', status: 'learning', shelved: true }),
    makeRow({ id: 'recent', name: 'Recent Slide', status: 'solo_ready', shelved: true, last_practiced_at: daysAgo(3) }),
  ];
  const rows = [...shelved, makeRow({ id: 'in-rotation', name: 'In Rotation', status: 'learning' })];

  it('devuelve solo las aparcadas, nunca tocada primero y después las más abandonadas', () => {
    expect(visibleShelved(rows, '', NOW).map((row) => row.id)).toEqual(['never', 'old', 'recent']);
  });

  it('conserva el peldaño de cada aparcada: el cajón no agrupa', () => {
    expect(visibleShelved(rows, '', NOW).map((row) => row.status)).toEqual([
      'learning',
      'playing_along',
      'solo_ready',
    ]);
  });

  it('respeta el buscador de la home, igual que las bandas', () => {
    expect(visibleShelved(rows, 'slide', NOW).map((row) => row.id)).toEqual(['recent']);
    // Sin distinguir mayúsculas ni diacríticos.
    expect(visibleShelved(rows, 'JIG', NOW).map((row) => row.id)).toEqual(['never']);
  });

  it('sin coincidencias devuelve vacío: la sección no se pinta', () => {
    expect(visibleShelved(rows, 'no existe', NOW)).toEqual([]);
  });

  it('sin aparcadas devuelve vacío y no muta la entrada', () => {
    const inRotation = [makeRow({ id: 'a', status: 'to_learn' }), makeRow({ id: 'b', status: 'solo_ready' })];
    const copy = [...inRotation];
    expect(visibleShelved(inRotation, '', NOW)).toEqual([]);
    expect(inRotation).toEqual(copy);
  });

  it('una aparcada sin ensayos encabeza el cajón y no la banda', () => {
    const never = makeRow({ id: 'never', status: 'to_learn', shelved: true });
    const groups = groupIntoBands([never], NOW);
    expect(groups[0].rows).toEqual([]);
    expect(visibleShelved([never], '', NOW).map((row) => row.id)).toEqual(['never']);
  });
});

describe('cardKey', () => {
  it('devuelve null cuando no hay tonalidad, para escribir «key not set»', () => {
    expect(cardKey(makeRow({ id: 'x', key: null }))).toBeNull();
    expect(cardKey(makeRow({ id: 'y', key: '   ' }))).toBeNull();
    expect(cardKey(makeRow({ id: 'z', key: 'D' }))).toBe('D');
  });

  it('prefiere el override personal', () => {
    const row: RepertoireRow = { ...makeRow({ id: 'x', key: 'D' }), custom_key: 'G' };
    expect(cardKey(row)).toBe('G');
    // La tabla sigue mostrando su guion de siempre (no se toca esa vista).
    expect(displayKey(makeRow({ id: 'none', key: null }))).toBe('—');
  });
});
