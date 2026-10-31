import { describe, it, expect } from 'vitest';
import type { TuneStatus } from './repertoire-model';
import { 
  computeTargets, 
  urgencyOf, 
  buildPracticeList, 
  hashSeed, 
  mulberry32,
  PRACTICE_FACTORS,
  KNOWN_STATUSES
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
});
