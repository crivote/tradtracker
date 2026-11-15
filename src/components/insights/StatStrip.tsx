import { Show } from 'solid-js';
import type { OverdueHistogram } from '../../lib/insights';
import type { StreakSummary } from '../../lib/practice-history';
import { pctText, sharePct } from './format';

/**
 * Las cuatro cifras de la home (#22, revisadas en #65), sin gráfica: qué se ha
 * pasado de su intervalo, qué sigue vivo, cuántos días seguidos se lleva y qué
 * no tiene registro todavía.
 *
 * Tres reglas del corte, que no se re-deciden:
 *
 *   · **Cada porcentaje dice su denominador.** El de vencidas es la parte que el
 *     lector no podía reconstruir —la tarjeta daba 68.9 % y el pie de la gráfica
 *     79.1 % de lo mismo—, así que aquí va escrito: «de las 286 con registro».
 *     Una cifra sin denominador no dice nada y con el denominador equivocado
 *     dice otra cosa.
 *   · **`no record` vive aquí y solo aquí**: la barra gris del histograma era la
 *     misma cifra repetida y desvirtuaba el eje de la gráfica.
 *   · **Las cifras no son enlaces**: no hay ruta por «sin registro» ni por
 *     «vivas», y una cifra que parece un botón y no lleva a ninguna parte es peor
 *     que un número quieto. El detalle está en el `title` de cada una.
 */
export default function StatStrip(props: {
  histogram: OverdueHistogram;
  /** Tunes distintas con marca en los últimos 14 días. */
  alive: number;
  /** Racha actual, mejor y anterior. */
  streak: StreakSummary;
}) {
  /** Participación de «sin registro» sobre el universo en rotación. */
  const noRecordPct = () => sharePct(props.histogram.sinRegistro, props.histogram.universe);
  /** Las que se pueden juzgar: el universo menos las que no tienen registro. */
  const judged = () => Math.max(0, props.histogram.universe - props.histogram.sinRegistro);

  return (
    <section class="insights-stats" aria-label="Repertoire status">
      <Show
        when={props.histogram.universe > 0}
        fallback={
          <p class="insights-empty">
            Nothing in rotation yet — every tune is still in the backlog or in the drawer.
          </p>
        }
      >
        <div class="stat" title="Past the practice interval of their level">
          <b>{props.histogram.overdue}</b>
          <small>
            overdue · {pctText(props.histogram.overduePct)} of {judged()}
          </small>
        </div>

        <div class="stat" title="Different tunes practiced in the last 14 days">
          <b>{props.alive}</b>
          <small>alive · 14 days</small>
        </div>

        <div class="stat" title="Consecutive days with at least one practice">
          <b>{props.streak.current}</b>
          <small>day streak</small>
          <span class="stat-note">
            {props.streak.best > 0 ? `best ${props.streak.best}` : 'no run yet'}
            <Show when={props.streak.previous > 0}>
              {' · '}last {props.streak.previous}
            </Show>
          </span>
        </div>

        <div class="stat" title="In rotation with no practice recorded">
          <b>{props.histogram.sinRegistro}</b>
          <small>no record · {pctText(noRecordPct())}</small>
        </div>
      </Show>
    </section>
  );
}
