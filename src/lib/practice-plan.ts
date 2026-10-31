import type { TuneStatus } from './repertoire-model';

export interface PracticeCandidate {
  id: string;
  status: TuneStatus;
  addedAt: string;                 // ISO
  lastPracticedAt: string | null;  // ISO o null si nunca se ensayó
  rhythm: string | null;           // p. ej. 'Reel', 'Jig'
  favorite: boolean;
}

export interface UrgencyTargets {
  byStatus: Record<TuneStatus, number>;
  activeCount: number;
  dailyTarget: number;
}

export const PRACTICE_FACTORS: Record<TuneStatus, number> = {
  to_learn: 0.5,
  learning: 1,
  playing_along: 2,
  solo_ready: 4,
};

export const KNOWN_STATUSES: readonly TuneStatus[] = ['playing_along', 'solo_ready'];

export function computeTargets(activeCount: number, dailyTarget: number): UrgencyTargets {
  const byStatus = {} as Record<TuneStatus, number>;
  const ratio = activeCount / dailyTarget;
  
  (Object.keys(PRACTICE_FACTORS) as TuneStatus[]).forEach(status => {
    byStatus[status] = PRACTICE_FACTORS[status] * ratio;
  });

  return { byStatus, activeCount, dailyTarget };
}

export function urgencyOf(
  candidate: PracticeCandidate,
  targets: UrgencyTargets,
  nowMs: number,
  recentIds?: ReadonlySet<string>,
): number {
  const lastTouchMs = Date.parse(candidate.lastPracticedAt ?? candidate.addedAt);
  const days = Math.max(0, (nowMs - lastTouchMs) / 86_400_000);
  
  const T = targets.byStatus[candidate.status];
  let urgency = days / T;

  if (recentIds?.has(candidate.id)) {
    urgency *= 0.5;
  }
  if (candidate.favorite) {
    urgency *= 1.4;
  }

  return urgency;
}

export interface BuildOptions {
  seed: number;
  nowMs: number;
  dailyTarget: number;
  recentIds?: ReadonlySet<string>;
  maxConsecutiveRhythm?: number;  // default 3
  knownThreshold?: number;        // default 8
}

export type PracticeReason = 'overdue' | 'rest' | 'fill';

export interface PracticeEntry {
  candidate: PracticeCandidate;
  urgency: number;
  reason: PracticeReason;
}

export interface PracticeList {
  entries: PracticeEntry[];
  overflow: number;               // vencidas que no cupieron; 0 si no desborda
}

/** Comparación por code unit: NO localeCompare (depende de la ICU y rompe el determinismo
 *  entre Node y navegador; la lista del día debe ser idéntica en ambos). */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function hashSeed(userId: string, dateKey: string): number {
  const str = userId + dateKey;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash >>> 0; // Convert to uint32
}

export function mulberry32(seed: number): () => number {
  // seed 0 es punto fijo del mezclador (devolvería 0 siempre): se sustituye por una constante.
  let s = (seed >>> 0) || 0x9e3779b9;
  return function() {
    s = Math.imul(s ^ (s >>> 16), 0x21f0aaad);
    s = Math.imul(s ^ (s >>> 15), 0x735a2d97);
    s = (s ^ (s >>> 15)) >>> 0;
    return s / 4294967296;
  };
}

export function buildPracticeList(
  candidates: readonly PracticeCandidate[],
  opts: BuildOptions,
): PracticeList {
  const {
    seed,
    nowMs,
    dailyTarget,
    recentIds,
    maxConsecutiveRhythm = 3,
    knownThreshold = 8,
  } = opts;

  // 1. Determinismo: Sort by ID
  const sortedCandidates = [...candidates].sort((a, b) => byCodeUnit(a.id, b.id));
  const rng = mulberry32(seed);

  // Targets
  const activeCount = sortedCandidates.length;
  const targets = computeTargets(activeCount, dailyTarget);

  // Urgencies
  const candidatesWithUrgency = sortedCandidates.map(c => ({
    candidate: c,
    urgency: urgencyOf(c, targets, nowMs, recentIds),
  }));

  // 2. Overdue candidates (urgency >= 2)
  const overdue = candidatesWithUrgency
    .filter(item => item.urgency >= 2)
    .sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (a.candidate.favorite !== b.candidate.favorite) return a.candidate.favorite ? -1 : 1;
      return byCodeUnit(a.candidate.id, b.candidate.id);
    });

  if (overdue.length > dailyTarget) {
    return {
      entries: overdue.slice(0, dailyTarget).map(item => ({
        candidate: item.candidate,
        urgency: item.urgency,
        reason: 'overdue',
      })),
      overflow: overdue.length - dailyTarget,
    };
  }

  // 3. Regular build
  const entries: PracticeEntry[] = [];
  const chosenIds = new Set<string>();
  
  // Put all overdue first
  for (const item of overdue) {
    entries.push({
      candidate: item.candidate,
      urgency: item.urgency,
      reason: 'overdue',
    });
    chosenIds.add(item.candidate.id);
  }

  // Helper to check diversification
  const canAddRhythm = (rhythm: string | null) => {
    if (rhythm === null) return true;
    if (entries.length < maxConsecutiveRhythm) return true;
      
    const lastRhythms = entries.slice(-maxConsecutiveRhythm).map(e => e.candidate.rhythm?.toLowerCase());
    if (lastRhythms.length < maxConsecutiveRhythm) return true;
      
    const allSame = lastRhythms.every(r => r === rhythm.toLowerCase());
      
    if (!allSame) return true;
      
    // If all remaining candidates have the same rhythm, it's allowed
    const remaining = sortedCandidates.filter(c => !chosenIds.has(c.id));
    const othersExist = remaining.some(c => c.rhythm?.toLowerCase() !== rhythm.toLowerCase());
    return !othersExist;
  };

  // Fill up to dailyTarget
  while (entries.length < dailyTarget) {
    const pos = entries.length + 1;
    
    // Check if this is a 'rest' position
    let isRestPos = false;
    if (pos === 4) {
      isRestPos = true;
    } else if (pos % 4 === 0) {
      const knownCount = sortedCandidates.filter(c => KNOWN_STATUSES.includes(c.status)).length;
      if (knownCount >= knownThreshold) {
        isRestPos = true;
      }
    }

    if (isRestPos) {
      // Try to find a 'rest' candidate
      const knownCandidates = sortedCandidates
        .filter(c => KNOWN_STATUSES.includes(c.status) && !chosenIds.has(c.id))
        .sort((a, b) => {
          if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
          const aDays = (nowMs - Date.parse(a.lastPracticedAt ?? a.addedAt)) / 86_400_000;
          const bDays = (nowMs - Date.parse(b.lastPracticedAt ?? b.addedAt)) / 86_400_000;
          if (bDays !== aDays) return bDays - aDays;
          return byCodeUnit(a.id, b.id);
        });

      if (knownCandidates.length > 0) {
        // Find first one that satisfies diversification
        const found = knownCandidates.find(c => canAddRhythm(c.rhythm));
        if (found) {
          const urgency = urgencyOf(found, targets, nowMs, recentIds);
          entries.push({ candidate: found, urgency, reason: 'rest' });
          chosenIds.add(found.id);
          continue;
        }
      }
    }

    // Fill normally (Weighted sampling)
    const pool = sortedCandidates
      .filter(c => !chosenIds.has(c.id))
      .map(c => ({
        candidate: c,
        urgency: urgencyOf(c, targets, nowMs, recentIds),
      }));

    if (pool.length === 0) break;

    // Efraimidis-Spirakis: score = u^(1/w)
    const scoredPool = pool.map(item => ({
      ...item,
      score: Math.pow(rng(), 1 / Math.max(1e-6, item.urgency)),
    }));

    // Sort by score descending
    scoredPool.sort((a, b) => b.score - a.score);

    // Find first that satisfies diversification
    const found = scoredPool.find(item => canAddRhythm(item.candidate.rhythm));
    
    if (found) {
      entries.push({
        candidate: found.candidate,
        urgency: found.urgency,
        reason: 'fill',
      });
      chosenIds.add(found.candidate.id);
    } else {
      break;
    }
  }

  return {
    entries,
    overflow: 0,
  };
}
