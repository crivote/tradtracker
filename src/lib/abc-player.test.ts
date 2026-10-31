import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPO,
  LOOP_GAP_MS,
  MAX_TEMPO,
  MIN_TEMPO,
  TEMPO_BY_RHYTHM,
  TEMPO_STEP,
  clampTempo,
  tempoFor,
} from './abc-player';

describe('tempoFor', () => {
  it('gives each tune type the practice tempo of the design', () => {
    expect(tempoFor('reel')).toBe(84);
    expect(tempoFor('hornpipe')).toBe(84);
    expect(tempoFor('jig')).toBe(108);
    expect(tempoFor('slip jig')).toBe(108);
    expect(tempoFor('slide')).toBe(120);
    expect(tempoFor('polka')).toBe(120);
    expect(tempoFor('air')).toBe(60);
  });

  it('ignores case and stray spaces, so what the database holds still matches', () => {
    expect(tempoFor('Reel')).toBe(84);
    expect(tempoFor('  JIG  ')).toBe(108);
    expect(tempoFor('Slip  Jig')).toBe(108);
    expect(tempoFor('SLIP JIG')).toBe(108);
  });

  it('falls back to the default for no rhythm and for an unknown one', () => {
    expect(tempoFor(null)).toBe(DEFAULT_TEMPO);
    expect(tempoFor('')).toBe(DEFAULT_TEMPO);
    expect(tempoFor('   ')).toBe(DEFAULT_TEMPO);
    expect(tempoFor('waltz')).toBe(DEFAULT_TEMPO);
    expect(tempoFor('—')).toBe(DEFAULT_TEMPO);
  });

  it('keeps every table entry inside the usable window', () => {
    for (const bpm of Object.values(TEMPO_BY_RHYTHM)) {
      expect(bpm).toBeGreaterThanOrEqual(MIN_TEMPO);
      expect(bpm).toBeLessThanOrEqual(MAX_TEMPO);
    }
  });
});

describe('clampTempo', () => {
  it('lets a tempo inside the window through untouched', () => {
    expect(clampTempo(84)).toBe(84);
    expect(clampTempo(MIN_TEMPO)).toBe(MIN_TEMPO);
    expect(clampTempo(MAX_TEMPO)).toBe(MAX_TEMPO);
  });

  it('stops at the floor and at the ceiling', () => {
    expect(clampTempo(MIN_TEMPO - 1)).toBe(MIN_TEMPO);
    expect(clampTempo(0)).toBe(MIN_TEMPO);
    expect(clampTempo(-120)).toBe(MIN_TEMPO);
    expect(clampTempo(MAX_TEMPO + 4)).toBe(MAX_TEMPO);
    expect(clampTempo(10000)).toBe(MAX_TEMPO);
  });

  it('rounds the decimals the four-beat step can produce', () => {
    expect(clampTempo(84.4)).toBe(84);
    expect(clampTempo(84.5)).toBe(85);
    expect(clampTempo(107.6)).toBe(108);
  });

  it('falls back to the default for values that are not a tempo at all', () => {
    expect(clampTempo(Number.NaN)).toBe(DEFAULT_TEMPO);
    expect(clampTempo(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TEMPO);
  });
});

describe('the player constants', () => {
  it('waits one second between loop passes', () => {
    expect(LOOP_GAP_MS).toBe(1000);
  });

  it('moves the tempo in steps of four beats', () => {
    expect(TEMPO_STEP).toBe(4);
    // El paso nunca puede sacar del margen a un tempo que ya estaba dentro.
    expect(clampTempo(DEFAULT_TEMPO + TEMPO_STEP)).toBeLessThanOrEqual(MAX_TEMPO);
    expect(clampTempo(MIN_TEMPO + TEMPO_STEP)).toBeGreaterThanOrEqual(MIN_TEMPO);
  });
});
