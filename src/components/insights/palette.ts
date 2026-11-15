/**
 * Paleta de las cuatro gráficas del panel (#22).
 *
 * Son los colores del **ámbito de papel** —los de `.repertoire-home` en
 * `repertoire.css`— escritos aquí porque Chart.js pinta sobre canvas y no lee
 * variables CSS. Un solo sitio donde mirarlos: si mañana cambia `--accent`, se
 * cambia en dos sitios y no en nueve llamadas sueltas.
 *
 * Los cinco peldaños van en una rampa de tinta que sube con la escalera: la
 * altura de la barra y su tono dicen lo mismo. `unknown` es el gris cálido de
 * las semanas sin estado registrado —la escalera solo tiene historia desde
 * finales de octubre— y `noRecord` es más oscuro a propósito: una tune sin
 * registro **no es una barra gris de relleno**, es un dato ausente que va
 * primero y aparte.
 */
import type { LadderStatus } from '../../lib/repertoire-model';

export const INSIGHT_PALETTE = {
  ink: '#241f18',
  muted: '#6b6154',
  faint: '#9c9282',
  line: '#ded6c6',
  accent: '#8a3524',
  paper: '#f2ede2',
  /** `sin registro`: la barra aparte, más oscura que el gris de `sinEstado`. */
  noRecord: '#8c8577',
  /** `sinEstado` en la composición: semanas anteriores al primer evento. */
  unknown: '#cfc6b4',
  /** El backlog en el donut de niveles: por debajo de la escalera, sin tinta. */
  backlog: '#cfc6b4',
  /** Las aparcadas en el donut: conservan peldaño pero están fuera. */
  shelved: '#a49a89',
  /** Rampa de los cinco peldaños, de abajo arriba de la escalera. */
  bands: {
    learning: '#b98a6a',
    shaky: '#a9714f',
    playing_along: '#96603f',
    solo_ready: '#7d4a30',
    mastered: '#5c3423',
  } as Record<LadderStatus, string>,
} as const;

/** Color de un peldaño; el mismo para la leyenda, la barra y el tooltip. */
export function bandColor(band: LadderStatus): string {
  return INSIGHT_PALETTE.bands[band];
}
