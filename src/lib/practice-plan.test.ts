import { describe, it, expect } from 'vitest';
import type { LadderStatus, RepertoireRow } from './repertoire-model';
import type { PracticeCandidate } from './practice-plan';
import { todayKeyFor } from './practice-storage';
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
  /**
   * Día local (`YYYY-MM-DD`) de hace `days` días: el candidato lleva el día del
   * último ensayo, no el instante. Se compone con `todayKeyFor` —nunca con
   * `toISOString().slice(0, 10)`, que a las 23:00 locales ya es el día siguiente.
   */
  const dayBefore = (days: number) => todayKeyFor(nowMs - days * 86_400_000);
  const tomorrow = dayBefore(-1);

  describe('computeTargets', () => {
    it('calculates targets correctly for 421/8', () => {
      const targets = computeTargets(421, 8);
      // T(peldaño) = factor * (421 / 8) = factor * 52.625
      // learning: 1 * 52.625 · shaky: 1.5 · playing_along: 2 · solo_ready: 4
      // mastered: 6 * 52.625 = 315.75
      // El backlog (`to_learn`) NO tiene intervalo: no es un peldaño (#50).
      expect(targets.byStatus.learning).toBeCloseTo(52.6, 1);
      expect(targets.byStatus.shaky).toBeCloseTo(78.9, 1);
      expect(targets.byStatus.playing_along).toBeCloseTo(105.3, 1);
      expect(targets.byStatus.solo_ready).toBeCloseTo(210.5, 1);
      expect(targets.byStatus.mastered).toBeCloseTo(315.75, 2);
      expect(Object.keys(targets.byStatus)).not.toContain('to_learn');
    });
  });

  describe('factores por peldaño (#46, cima en #50)', () => {
    it('mastered es la que menos se toca, y el backlog no tiene factor', () => {
      expect(PRACTICE_FACTORS.mastered).toBeGreaterThan(PRACTICE_FACTORS.solo_ready);
      expect(Object.keys(PRACTICE_FACTORS)).not.toContain('to_learn');
      expect(Object.keys(PRACTICE_FACTORS)).toHaveLength(5);
    });

    it('el descanso admite mastered y nunca el backlog', () => {
      expect(KNOWN_STATUSES).toContain('mastered');
      expect(KNOWN_STATUSES).not.toContain('to_learn');
    });

    it('a igual antigüedad, mastered es menos urgente que cualquier peldaño de abajo', () => {
      const targets = computeTargets(50, 8);
      const base = {
        id: 'x',
        addedAt: new Date(nowMs - 40 * 86_400_000).toISOString(),
        lastPracticedDay: dayBefore(30),
        rhythm: 'Reel',
        favorite: false,
      };
      const mastered = urgencyOf({ ...base, status: 'mastered' }, targets, nowMs);
      for (const status of ['learning', 'shaky', 'playing_along', 'solo_ready'] as const) {
        expect(mastered).toBeLessThan(urgencyOf({ ...base, status }, targets, nowMs));
      }
    });
  });

  describe('urgencyOf', () => {
    const targets = computeTargets(421, 8);

    it('handles learning candidate never practiced (10 days ago)', () => {
      const candidate = {
        id: '1',
        status: 'learning' as const,
        addedAt: tenDaysAgo,
        lastPracticedDay: null,
        rhythm: 'Reel',
        favorite: false,
      };
      const urgency = urgencyOf(candidate, targets, nowMs);
      expect(urgency).toBeCloseTo(10 / targets.byStatus.learning, 5);
      expect(urgency).not.toBe(Infinity);
      expect(urgency).not.toBeNaN();
    });

    it('applies 1.4x bonus for favorites', () => {
      const c1 = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedDay: null, rhythm: 'Reel', favorite: false };
      const c2 = { ...c1, id: '2', favorite: true };
      const u1 = urgencyOf(c1, targets, nowMs);
      const u2 = urgencyOf(c2, targets, nowMs);
      expect(u2).toBeCloseTo(u1 * 1.4, 5);
    });

    it('respects hierarchy: solo_ready favorite does not exceed learning normal if time is same', () => {
      // learning: T=52.6, days=10 -> u=10/52.6 = 0.19
      // solo_ready: T=210.5, days=10, fav=true -> u=(10/210.5)*1.4 = 0.066
      const cLearning = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedDay: null, rhythm: 'Reel', favorite: false };
      const cSolo = { id: '2', status: 'solo_ready' as const, addedAt: tenDaysAgo, lastPracticedDay: null, rhythm: 'Reel', favorite: true };
      
      expect(urgencyOf(cLearning, targets, nowMs)).toBeGreaterThan(urgencyOf(cSolo, targets, nowMs));
    });

    it('applies 0.5x penalty for recentIds', () => {
      const candidate = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedDay: null, rhythm: 'Reel', favorite: false };
      const uNormal = urgencyOf(candidate, targets, nowMs);
      const uRecent = urgencyOf(candidate, targets, nowMs, new Set(['1']));
      expect(uRecent).toBeCloseTo(uNormal * 0.5, 5);
    });

    it('clamps days to 0 if the last practiced day is in the future', () => {
      const candidate = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedDay: tomorrow, rhythm: 'Reel', favorite: false };
      const urgency = urgencyOf(candidate, targets, nowMs);
      expect(urgency).toBe(0);
    });

    it('cuenta los días desde la medianoche local: las 23:30 del día 10 son el día 10', () => {
      // Frontera del huso. En Madrid, `Date.parse('2026-11-10')` es medianoche
      // UTC = 01:00 local, así que leerlo como instante mueve la antigüedad una
      // hora y, cerca de medianoche, un día entero.
      const lateNight = new Date(2026, 10, 10, 23, 30).getTime();
      const candidate = { id: '1', status: 'learning' as const, addedAt: tenDaysAgo, lastPracticedDay: '2026-11-10', rhythm: 'Reel', favorite: false };
      const single = computeTargets(1, 1); // T(learning) = 1 día: urgencia = días

      // 23:30 del 10: aún es el día en que se tocó (23,5 horas, no más).
      expect(urgencyOf(candidate, single, lateNight)).toBeCloseTo(23.5 / 24, 5);
      // 00:30 del 11: el día 10 ya ha cumplido entero, no «casi».
      expect(urgencyOf(candidate, single, lateNight + 3_600_000)).toBeGreaterThan(1);
    });
  });

  describe('buildPracticeList', () => {
    const targets = computeTargets(10, 5); // T = factor * 2
    // learning: 2 · shaky: 3 · playing_along: 4 · solo_ready: 8 · mastered: 12
    // (`to_learn` no tiene intervalo: es el backlog, no un peldaño — #50)

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
        lastPracticedDay: null,
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
        status: (i < 10 ? 'solo_ready' : 'learning') as LadderStatus,
        addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(),
        lastPracticedDay: null,
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
        status: (i < 3 ? 'solo_ready' : 'learning') as LadderStatus,
        addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(),
        lastPracticedDay: null,
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
        ...Array.from({ length: 6 }, (_, i) => ({ id: `jig${i}`, status: 'learning' as const, addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(), lastPracticedDay: null, rhythm: 'Jig', favorite: false })),
        ...Array.from({ length: 6 }, (_, i) => ({ id: `reel${i}`, status: 'learning' as const, addedAt: new Date(nowMs - 1 * 86_400_000).toISOString(), lastPracticedDay: null, rhythm: 'Reel', favorite: false })),
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
        lastPracticedDay: null,
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
    /** Día local de hace `days` días, como lo guarda `pr_repertoire.last_practiced_day`. */
    const day = (daysAgo: number) => todayKeyFor(nowMs - daysAgo * 86_400_000);
    const mk = (id: string, over: Partial<PracticeCandidate> = {}): PracticeCandidate => ({
      id, status: 'learning', addedAt: iso(0), lastPracticedDay: day(0), rhythm: 'Reel', favorite: false, ...over,
    });

    it('fija el umbral de la regla dura en 2: por debajo no entra, por encima sí', () => {
      // 100 candidatas y dailyTarget 10 => T(learning) = 10 días => la línea está
      // en 20 días. La antigüedad se cuenta desde la medianoche local del día del
      // ensayo, así que 19 días quedan por debajo (19,x) y 20 por encima (20,x):
      // es el par más ajustado que admite la unidad de día.
      const base = Array.from({ length: 98 }, (_, i) => mk(`z${String(i).padStart(3, '0')}`));
      const low = mk('a-low', { lastPracticedDay: day(19) });   // 1.9x
      const high = mk('b-high', { lastPracticedDay: day(20) }); // 2.0x
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
          status: (i < 10 ? 'solo_ready' : 'learning') as LadderStatus, addedAt: iso(1),
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
      // Días locales: 2 días frente a hoy. Con T(learning) = 1,5 la urgencia de
      // los jigs es ~1,6 (<2, sin regla dura) y la de los reels ~0,3.
      const jigs = Array.from({ length: 6 }, (_, i) => mk(`j${i}`, { lastPracticedDay: day(2), rhythm: 'Jig' }));
      const reels = Array.from({ length: 6 }, (_, i) => mk(`r${i}`, { lastPracticedDay: day(0), rhythm: 'Reel' }));
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
    last_practiced_day: null,
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

  it('deja fuera el backlog: una pieza sin empezar no puede estar vencida (#50)', () => {
    const rows = [
      repertoireRow({ id: 'learning' }),
      repertoireRow({ id: 'deseo', status: 'to_learn' }),
      repertoireRow({ id: 'mastered', status: 'mastered' }),
    ];

    expect(toCandidates(rows).map((candidate) => candidate.id)).toEqual(['learning', 'mastered']);
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
        last_practiced_day: '2026-10-20',
      }),
    ];

    expect(toCandidates(rows)[0]).toEqual({
      id: 'a',
      status: 'solo_ready',
      addedAt: '2026-09-01T10:00:00Z',
      lastPracticedDay: '2026-10-20',
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
