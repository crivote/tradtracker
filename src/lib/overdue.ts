/**
 * La vara del vencimiento: qué peldaños cuentan y con qué días base.
 *
 * Vive aparte de `insights.ts` porque lo necesitan también las preferencias del
 * usuario (`practice-storage.ts`), y `insights.ts` ya importa de allí el reloj
 * de días: dejarlo en el mismo sitio cerraba un ciclo de módulos y `DEFAULT_PREFS`
 * se evaluaba con la base a `undefined`.
 */

/**
 * **Los cuatro peldaños que se mantienen.** `learning` no entra: es el taller,
 * no el repertorio; una tune que aún se está aprendiendo no forma parte de la
 * base que hay que sostener, y mezclarla con las demás falsea el tamaño. El
 * backlog (`to_learn`) tampoco: no tiene intervalo que cumplir.
 */
export const MAINTENANCE_BANDS = ['shaky', 'playing_along', 'solo_ready', 'mastered'] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_BANDS)[number];

/**
 * Días base por peldaño **sobre 100 tunes de repertorio real**.
 *
 * El intervalo que se aplica no es este número: es `base × (tamaño / 100)`, con
 * el tamaño del repertorio de mantenimiento (los cuatro escalones, sin
 * aparcadas, sin backlog y sin `learning`). Con 100 tunes la base vale tal cual;
 * con 356, un `shaky` aguanta 4 × 3,56 = 14 días. Sin esa ponderación, un
 * repertorio que crece hace que «vencida» sea matemáticamente inevitable: con
 * 356 tunes y 8 al día el ciclo completo son 42 días, y un umbral fijo de 7
 * exigiría volver seis veces antes.
 */
export const DEFAULT_OVERDUE_BASE: Record<MaintenanceStatus, number> = {
  shaky: 4,
  playing_along: 7,
  solo_ready: 14,
  mastered: 30,
};

/** Límites de un parámetro base en la pantalla de ajustes. */
export const OVERDUE_BASE_MIN = 1;
export const OVERDUE_BASE_MAX = 365;

/** El intervalo en días de un peldaño para un repertorio de `size` tunes. */
export function intervalDays(
  base: Record<MaintenanceStatus, number>,
  band: MaintenanceStatus,
  size: number,
): number {
  const scaled = (base[band] * Math.max(0, size)) / 100;
  return Math.max(1, scaled);
}

/** Copia normalizada de una base: números enteros y dentro de los límites. */
export function normalizeOverdueBase(
  value: unknown,
): Record<MaintenanceStatus, number> {
  const record = (value ?? {}) as Record<string, unknown>;
  const pick = (band: MaintenanceStatus): number => {
    const raw = record[band];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_OVERDUE_BASE[band];
    return Math.min(OVERDUE_BASE_MAX, Math.max(OVERDUE_BASE_MIN, Math.round(raw)));
  };
  return {
    shaky: pick('shaky'),
    playing_along: pick('playing_along'),
    solo_ready: pick('solo_ready'),
    mastered: pick('mastered'),
  };
}
