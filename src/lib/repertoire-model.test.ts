import { describe, expect, it } from 'vitest';
import {
  collationKey,
  displayKey,
  displayRhythm,
  displayTitle,
  mapRepertoireRow,
  overrideFields,
  parseViewMode,
  placeholderInitials,
  practiceRecency,
  sortRepertoire,
  type RepertoireRow,
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
  rating?: number | null;
  added_at?: string;
  last_practiced_at?: string | null;
}): RepertoireRow {
  const { name, ...overrides } = input;
  return mapRepertoireRow({
    ...baseRow,
    added_at: '2026-06-01T12:00:00Z',
    ...overrides,
    pr_tunes: { ...tune, name: name ?? tune.name },
  });
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
