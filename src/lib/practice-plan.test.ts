import { describe, it, expect } from 'vitest';
import type { RepertoireRow, TuneStatus } from './repertoire-model';
import type { PracticeCandidate } from './practice-plan';
import { 
  computeTargets, 
  urgencyOf, 
  buildPracticeList, 
  hashSeed, 
  mulberry32,
  PRACTICE_FACTORS,
  KNOWN_STATUSES,
  toCandidates,
  rowsByIds,
  favoriteSaturation,
  FAVORITE_SATURATION_THRESHOLD,
} from './practice-plan';

describe('Practice Plan Model', () => {
  const nowMs = new Date('2026-10-31T10:00:00Z').getTime();
  const tenDaysAgo = new Date(nowMs - 10 * 86_400_000).toISOString();
  const tomorrow = new Date(nowMs + 86_400_000).toISOString();

  describe('computeTargets', () => {
    it('calculates targets correctly for 421/8', () => {
      const targets = computeTargets(421, 8);
      // T(status) = factor * (421 / 8) = factor * 52.625
      // to_learn: 0.5 * 52.625 = 26.3125
      // learning: 1 * 52.625 = 52.625
      // playing_along: 2 * 52.625 = 105.25
      // solo_ready: 4 * 52.625 = 210.5
      expect(targets.byStatus.to_learn).toBeCloseTo(26.3, 1);
      expect(targets.byStatus.learning).toBeCloseTo(52.6, 1);
      expect(targets.byStatus.playing_along).toBeCloseTo(105.3, 1);
      expect(targets.byStatus.solo_ready).toBeCloseTo(210.5, 1);
    });
  });

  describe('urgencyOf', () => {
    const targets = computeTargets(421, 8);

    it('handles learning candidate never practiced (10 days ago)', () => {
      const candidate = {
        id: '1',
        status: 'learning' as const,
        addedAt: tenDaysAgo,
        lastPracticedAt: null,
        rhythm: 'Reel',
        favorite: false,
      };
      const urgency = urgencyOf(candidate, targets, nowMs);
      expect(urgency).toBeCloseTo(10 / targets.byStatus.learning, 5);
      expect(urgency).not.toBe(Infinity);
      expect(urgency).not.toBeNaN();
    });

    it('applies 1.4x bonus for favorites', () => {
      const c1 = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedAt: null, rhythm: 'Reel', favorite: false };
      const c2 = { ...c1, id: '2', favorite: true };
      const u1 = urgencyOf(c1, targets, nowMs);
      const u2 = urgencyOf(c2, targets, nowMs);
      expect(u2).toBeCloseTo(u1 * 1.4, 5);
    });

    it('respects hierarchy: solo_ready favorite does not exceed learning normal if time is same', () => {
      // learning: T=52.6, days=10 -> u=10/52.6 = 0.19
      // solo_ready: T=210.5, days=10, fav=true -> u=(10/210.5)*1.4 = 0.066
      const cLearning = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedAt: null, rhythm: 'Reel', favorite: false };
      const cSolo = { id: '2', status: 'solo_ready' as const, addedAt: tenDaysAgo, lastPracticedAt: null, rhythm: 'Reel', favorite: true };
      
      expect(urgencyOf(cLearning, targets, nowMs)).toBeGreaterThan(urgencyOf(cSolo, targets, nowMs));
    });

    it('applies 0.5x penalty for recentIds', () => {
      const candidate = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedAt: null, rhythm: 'Reel', favorite: false };
      const uNormal = urgencyOf(candidate, targets, nowMs);
      const uRecent = urgencyOf(candidate, targets, nowMs, new Set(['1']));
      expect(uRecent).toBeCloseTo(uNormal * 0.5, 5);
    });

    it('clamps days to 0 if lastPracticedAt is in the future', () => {
      const candidate = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedAt: tomorrow, rhythm: 'Reel', favorite: false };
      const urgency = urgencyOf(candidate, targets, nowMs);
      expect(urgency).toBe(0);
    });
  });

  describe('buildPracticeList', () => {
    const targets = computeTargets(10, 5); // T = factor * 2
    // to_learn: 1, learning: 2, playing_along: 4, solo_ready: 8

    it('handles empty candidates', () => {
      const result = buildPracticeList([], { seed: 123, nowMs, dailyTarget: 5 });
      expect(result.entries).toEqual([]);
      expect(result.overflow).toBe(0);
    });

    it('handles overflow when overdue > dailyTarget', () => {
      // 10 overdue candidates. Target 8.
      const candidates = Array.from({ length: 10 }, (_, i) => ({
        id: `id${i}`,
        status: 'learning' as const,
        addedAt: new Date(nowMs - (20 + i) * 86_400_000).toISOString(), // Very overdue
        lastPracticedAt: null,
        rhythm: 'Reel',
        favorite: false,
      }));
      const result = buildPracticeList(candidates, { seed: 123, nowMs, dailyTarget: 8 });
      expect(result.entries).toHaveLength(8);
      expect(result.overflow).toBe(2);
      expect(result.entries.every(e => e.reason === 'overdue')).toBe(true);
    });

    it('implements respiro positions based on knownThreshold', () => {
      // 10 known candidates, threshold 8. Positions 4 and 8 should be 'rest'.
      const candidates = Array.from({ length: 15 }, (_, i) => ({
        id: `id${i}`,
        status: (i < 10 ? 'solo_ready' : 'to_learn') as TuneStatus,
        addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(),
        lastPracticedAt: null,
        rhythm: 'Reel',
        favorite: false,
      }));
      
      const result = buildPracticeList(candidates, { seed: 123, nowMs, dailyTarget: 12, knownThreshold: 8 });
      
      expect(result.entries[3]?.reason).toBe('rest'); // pos 4
      expect(result.entries[7]?.reason).toBe('rest'); // pos 8
    });

    it('implements respiro position 4 only when known < knownThreshold', () => {
      // 3 known candidates, threshold 8. Only pos 4 should be 'rest'.
      const candidates = Array.from({ length: 15 }, (_, i) => ({
        id: `id${i}`,
        status: (i < 3 ? 'solo_ready' : 'to_learn') as TuneStatus,
        addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(),
        lastPracticedAt: null,
        rhythm: 'Reel',
        favorite: false,
      }));
      
      const result = buildPracticeList(candidates, { seed: 123, nowMs, dailyTarget: 12, knownThreshold: 8 });
      
      expect(result.entries[3]?.reason).toBe('rest'); // pos 4
      expect(result.entries[7]?.reason).not.toBe('rest'); // pos 8
    });

    it('diversifies rhythms (no runs of 4+)', () => {
      // 6 Jig + 6 Reel, target 8. maxConsecutive 3.
      const candidates = [
        ...Array.from({ length: 6 }, (_, i) => ({ id: `jig${i}`, status: 'learning' as const, addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(), lastPracticedAt: null, rhythm: 'Jig', favorite: false })),
        ...Array.from({ length: 6 }, (_, i) => ({ id: `reel${i}`, status: 'learning' as const, addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(), lastPracticedAt: null, rhythm: 'Reel', favorite: false })),
      ];
      
      const result = buildPracticeList(candidates, { seed: 123, nowMs, dailyTarget: 8, maxConsecutiveRhythm: 3 });
      
      let run = 1;
      let lastRhythm = result.entries[0].candidate.rhythm;
      for (let i = 1; i < result.entries.length; i++) {
        const curr = result.entries[i].candidate.rhythm;
        if (curr && curr.toLowerCase() === lastRhythm?.toLowerCase()) {
          run++;
          expect(run).toBeLessThan(4);
        } else {
          run = 1;
        }
        lastRhythm = curr;
      }
    });

    it('is deterministic with the same seed', () => {
      const candidates = Array.from({ length: 20 }, (_, i) => ({
        id: `id${i}`,
        status: 'learning' as const,
        addedAt: tenDaysAgo,
        lastPracticedAt: null,
        rhythm: i % 2 === 0 ? 'Jig' : 'Reel',
        favorite: i % 3 === 0,
      }));
      
      const opts = { seed: 42, nowMs, dailyTarget: 10 };
      const res1 = buildPracticeList(candidates, opts);
      const res2 = buildPracticeList(candidates, opts);
      
      expect(res1).toEqual(res2);
    });
  });

  describe('Determinism helpers', () => {
    it('hashSeed is deterministic', () => {
      expect(hashSeed('user1', '2026-10-31')).toBe(hashSeed('user1', '2026-10-31'));
    });

    it('mulberry32 is deterministic', () => {
      const rng1 = mulberry32(123);
      const rng2 = mulberry32(123);
      for (let i = 0; i < 100; i++) {
        expect(rng1()).toBe(rng2());
      }
    });
  });

  describe('umbrales y estructura (estos tests muerden)', () => {
    const iso = (daysAgo: number) => new Date(nowMs - daysAgo * 86_400_000).toISOString();
    const mk = (id: string, over: Partial<PracticeCandidate> = {}): PracticeCandidate => ({
      id, status: 'learning', addedAt: iso(0), lastPracticedAt: iso(0), rhythm: 'Reel', favorite: false, ...over,
    });

    it('fija el umbral de la regla dura en 2: 1.99 no entra, 2.01 si', () => {
      // 100 candidatas y dailyTarget 10 => T(learning) = 10 dias => urgencia = dias / 10
      const base = Array.from({ length: 98 }, (_, i) => mk(`z${String(i).padStart(3, '0')}`));
      const low = mk('a-low', { lastPracticedAt: iso(19.9) });   // 1.99
      const high = mk('b-high', { lastPracticedAt: iso(20.1) }); // 2.01
      const res = buildPracticeList([...base, low, high], { seed: 7, nowMs, dailyTarget: 10 });
      const eHigh = res.entries.find((e) => e.candidate.id === 'b-high');
      const eLow = res.entries.find((e) => e.candidate.id === 'a-low');
      expect(eHigh?.reason).toBe('overdue');
      expect(eLow).toBeDefined();
      expect(eLow?.reason).not.toBe('overdue');
    });

    it('el orden de entrada no influye en el resultado', () => {
      const cands = Array.from({ length: 20 }, (_, i) =>
        mk(`id${String(i).padStart(2, '0')}`, {
          addedAt: iso(10), rhythm: i % 2 === 0 ? 'Jig' : 'Reel', favorite: i % 3 === 0,
        }));
      const opts = { seed: 4242, nowMs, dailyTarget: 10 };
      expect(buildPracticeList(cands, opts)).toEqual(buildPracticeList([...cands].reverse(), opts));
    });

    it('el respiro ocupa solo las posiciones 4 y 8, no las intermedias', () => {
      const cands = Array.from({ length: 15 }, (_, i) =>
        mk(`id${String(i).padStart(2, '0')}`, {
          status: (i < 10 ? 'solo_ready' : 'to_learn') as TuneStatus, addedAt: iso(1),
        }));
      const res = buildPracticeList(cands, { seed: 123, nowMs, dailyTarget: 12, knownThreshold: 8 });
      expect(res.entries[3].reason).toBe('rest');
      expect(res.entries[4].reason).not.toBe('rest');
      expect(res.entries[5].reason).not.toBe('rest');
      expect(res.entries[6].reason).not.toBe('rest');
      expect(res.entries[7].reason).toBe('rest');
    });

    it('la diversificacion corta la racha que el muestreo produciria', () => {
      // Urgencias dispares pero <2 (sin regla dura): los jigs dominan el peso y saldrian seguidos.
      const jigs = Array.from({ length: 6 }, (_, i) => mk(`j${i}`, { lastPracticedAt: iso(2.5), rhythm: 'Jig' }));
      const reels = Array.from({ length: 6 }, (_, i) => mk(`r${i}`, { lastPracticedAt: iso(0.1), rhythm: 'Reel' }));
      const res = buildPracticeList([...jigs, ...reels], { seed: 99, nowMs, dailyTarget: 8, maxConsecutiveRhythm: 3 });
      let run = 1;
      for (let i = 1; i < res.entries.length; i++) {
        const prev = res.entries[i - 1].candidate.rhythm?.toLowerCase();
        const curr = res.entries[i].candidate.rhythm?.toLowerCase();
        run = curr && curr === prev ? run + 1 : 1;
        expect(run).toBeLessThan(4);
      }
      expect(new Set(res.entries.map((e) => e.candidate.rhythm)).size).toBeGreaterThan(1);
    });

    it('mulberry32 no degenera con semilla 0', () => {
      const rng = mulberry32(0);
      expect(new Set([rng(), rng(), rng(), rng()]).size).toBe(4);
    });
  });

});

/* ── vista de la lista del día (#36) ────────────────────────────── */

/** Una fila de repertorio completa, con todo lo que la vista puede leer. */
function repertoireRow(overrides: Partial<RepertoireRow> & { id: string; rhythm?: string | null }): RepertoireRow {
  const { rhythm, ...rest } = overrides;
  return {
    status: 'learning',
    shelved: false,
    favorite: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: null,
    added_at: '2026-09-01T10:00:00Z',
    last_practiced_at: null,
    tune: {
      id: `tune-${overrides.id}`,
      origin: 'thesession',
      origin_ref: '1',
      name: `Tune ${overrides.id}`,
      rhythm: rhythm === undefined ? 'Reel' : rhythm,
      meter: '4/4',
      key: 'D',
      abc: null,
    },
    image: null,
    practice_count: null,
    avg_quality: null,
    days_since_last_practice: null,
    ...rest,
  } as RepertoireRow;
}

describe('toCandidates (#36)', () => {
  it('deja fuera las aparcadas: el cajón no está en rotación', () => {
    const rows = [
      repertoireRow({ id: 'a' }),
      repertoireRow({ id: 'b', shelved: true }),
      repertoireRow({ id: 'c' }),
    ];

    expect(toCandidates(rows).map((candidate) => candidate.id)).toEqual(['a', 'c']);
  });

  it('usa el ritmo personal, no el del catálogo', () => {
    const rows = [repertoireRow({ id: 'a', rhythm: 'Reel', custom_rhythm: 'Hornpipe' })];
    expect(toCandidates(rows)[0].rhythm).toBe('Hornpipe');
  });

  it('cae al ritmo del catálogo cuando el personal está en blanco', () => {
    const rows = [repertoireRow({ id: 'a', rhythm: 'Jig', custom_rhythm: '   ' })];
    expect(toCandidates(rows)[0].rhythm).toBe('Jig');
  });

  it('sin ritmo de ningún tipo devuelve null (no agrupa), no el guion de la vista', () => {
    const rows = [repertoireRow({ id: 'a', rhythm: null })];
    const blank = repertoireRow({ id: 'b', rhythm: null, custom_rhythm: null });
    expect(toCandidates(rows)[0].rhythm).toBeNull();
    expect(toCandidates([blank])[0].rhythm).toBeNull();
  });

  it('copia lo que decide la urgencia: peldaño, alta, última práctica y favorita', () => {
    const rows = [
      repertoireRow({
        id: 'a',
        status: 'solo_ready',
        favorite: true,
        last_practiced_at: '2026-10-20T09:00:00Z',
      }),
    ];

    expect(toCandidates(rows)[0]).toEqual({
      id: 'a',
      status: 'solo_ready',
      addedAt: '2026-09-01T10:00:00Z',
      lastPracticedAt: '2026-10-20T09:00:00Z',
      rhythm: 'Reel',
      favorite: true,
    });
  });
});

describe('rowsByIds (#36)', () => {
  const rows = [
    repertoireRow({ id: 'a' }),
    repertoireRow({ id: 'b' }),
    repertoireRow({ id: 'c' }),
  ];

  it('conserva el orden de los ids, no el de las filas', () => {
    expect(rowsByIds(rows, ['c', 'a', 'b']).map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });

  it('descarta los ids que ya no existen y no deja hueco', () => {
    expect(rowsByIds(rows, ['b', 'gone', 'a']).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('una lista vacía devuelve una lista vacía', () => {
    expect(rowsByIds(rows, [])).toEqual([]);
  });

  it('no inventa filas ni repite una id repetida', () => {
    const picked = rowsByIds(rows, ['a', 'a', 'b']);
    expect(picked.map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('favoriteSaturation (#36)', () => {
  it('con el repertorio vacío no hay proporción ni aviso (0, no NaN)', () => {
    expect(favoriteSaturation([])).toEqual({
      favoriteCount: 0,
      activeCount: 0,
      ratio: 0,
      overThreshold: false,
    });
  });

  it('con el 30 % justo todavía discrimina: no avisa', () => {
    const rows = [
      repertoireRow({ id: 'a', favorite: true }),
      repertoireRow({ id: 'b', favorite: true }),
      repertoireRow({ id: 'c', favorite: true }),
      repertoireRow({ id: 'd' }),
      repertoireRow({ id: 'e' }),
      repertoireRow({ id: 'f' }),
      repertoireRow({ id: 'g' }),
      repertoireRow({ id: 'h' }),
      repertoireRow({ id: 'i' }),
      repertoireRow({ id: 'j' }),
    ];

    const saturation = favoriteSaturation(rows);
    expect(saturation.favoriteCount).toBe(3);
    expect(saturation.activeCount).toBe(10);
    expect(saturation.ratio).toBe(FAVORITE_SATURATION_THRESHOLD);
    expect(saturation.overThreshold).toBe(false);
  });

  it('por encima del umbral avisa', () => {
    const rows = [
      repertoireRow({ id: 'a', favorite: true }),
      repertoireRow({ id: 'b', favorite: true }),
      repertoireRow({ id: 'c', favorite: true }),
      repertoireRow({ id: 'd' }),
      repertoireRow({ id: 'e' }),
    ];

    const saturation = favoriteSaturation(rows);
    expect(saturation.ratio).toBeCloseTo(0.6, 5);
    expect(saturation.overThreshold).toBe(true);
  });

  it('las aparcadas no cuentan: no están en rotación', () => {
    const rows = [
      repertoireRow({ id: 'a', favorite: true }),
      repertoireRow({ id: 'b' }),
      repertoireRow({ id: 'c', favorite: true, shelved: true }),
      repertoireRow({ id: 'd', shelved: true }),
    ];

    const saturation = favoriteSaturation(rows);
    expect(saturation.favoriteCount).toBe(1);
    expect(saturation.activeCount).toBe(2);
    expect(saturation.ratio).toBe(0.5);
    expect(saturation.overThreshold).toBe(true);
  });
});
