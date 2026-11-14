import { Show } from 'solid-js';
import type { OverdueHistogram } from '../../lib/insights';
import { pctText, sharePct } from './format';

/**
 * Las cuatro cifras de la home (#22), sin gráfica: qué está sin registro, qué se
 * ha pasado de su intervalo, qué sigue vivo y cuántos días seguidos se lleva.
 *
 * Las cifras **no son enlaces**: no hay ruta por «sin registro» ni por «vivas»,
 * y una cifra que parece un botón y no lleva a ninguna parte es peor que un
 * número quieto. El detalle está en el `title` de cada una, que es donde cabe la
 * frase que explica el denominador.
 *
 * Ninguna cifra se inventa: `sinRegistro` y `overdue` salen del histograma del
 * corte A tal cual, con su mismo universo y sus mismos umbrales.
 */
export default function StatStrip(props: {
  histogram: OverdueHistogram;
  /** Tunes distintas con marca en los últimos 14 días. */
  alive: number;
  /** Días consecutivos con ensayo. */
  streak: number;
}) {
  /** Participación de «sin registro» sobre el universo en rotación. */
  const noRecordPct = () => sharePct(props.histogram.sinRegistro, props.histogram.universe);

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
        <div class="stat" title="In rotation with no practice recorded">
          <b>{props.histogram.sinRegistro}</b>
          <small>no record · {pctText(noRecordPct())}</small>
        </div>

        <div class="stat" title="Past the practice interval of their level">
          <b>{props.histogram.overdue}</b>
          <small>overdue · {pctText(props.histogram.overduePct)}</small>
        </div>

        <div class="stat" title="Different tunes practiced in the last 14 days">
          <b>{props.alive}</b>
          <small>alive · 14 days</small>
        </div>

        <div class="stat" title="Consecutive days with at least one practice">
          <b>{props.streak}</b>
          <small>day streak</small>
        </div>
      </Show>
    </section>
  );
}
