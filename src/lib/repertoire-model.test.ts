import { describe, expect, it } from 'vitest';
import {
  displayKey,
  displayRhythm,
  displayTitle,
  mapRepertoireRow,
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
  status: 'nueva',
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
    expect(row.status).toBe('nueva');
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
