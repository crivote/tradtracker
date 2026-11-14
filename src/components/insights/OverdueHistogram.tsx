import { Show, createMemo } from 'solid-js';
import type { OverdueDelta, OverdueHistogram as Histogram } from '../../lib/insights';
import { previousSundayLabel } from '../../lib/insights-view';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';
import { pctText, sharePct, signedPpText } from './format';

/**
 * El histograma del vencimiento (#22): cuántos días lleva cada tune en rotación
 * sin tocarse, y qué se ha pasado ya del intervalo de su peldaño.
 *
 * La barra de **`sin registro` va primera y aparte**, con un hueco de un valor
 * `null` entre ella y los tramos: una tune que nunca se ha tocado no está «de
 * 60+ días», está sin dato, y meterla en el último tramo sería mentir con la
 * forma de la gráfica. Su color también es otro —gris de dato ausente, no tinta
 * de barra—. Los seis tramos se pintan con el universo entero como denominador,
 * así que tramos + `sin registro` suman el 100 % de lo que hay en rotación.
 *
 * Debajo va el delta contra el domingo de la semana pasada. Si el modelo dice
 * que no hay historial suficiente, no se enseña una cifra: se dice **«No history
 * yet»**, porque un `+0.0 pp` calculado sobre cero observaciones se lee como
 * «todo igual» y no es eso.
 */
export default function OverdueHistogram(props: {
  histogram: Histogram;
  delta: OverdueDelta;
  /** Instante de la vista: fecha el domingo con el que se compara. */
  nowMs: number;
}) {
  /** Un hueco visual entre `sin registro` y el primer tramo: `null`, no `0`. */
  const GAP = '';

  const labels = createMemo(() => [
    'No record',
    GAP,
    ...props.histogram.buckets.map((bucket) => bucket.label),
  ]);

  const data = createMemo<(number | null)[]>(() => [
    props.histogram.sinRegistro,
    null,
    ...props.histogram.buckets.map((bucket) => bucket.count),
  ]);

  const colors = createMemo(() => [
    INSIGHT_PALETTE.noRecord,
    'transparent',
    ...props.histogram.buckets.map(() => INSIGHT_PALETTE.accent),
  ]);

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'bar',
    data: {
      labels: labels(),
      datasets: [
        {
          label: 'Tunes',
          data: data(),
          backgroundColor: colors(),
          borderRadius: 2,
          maxBarThickness: 46,
        },
      ],
    },
    options: {
      // Cuatro gráficas animando a la vez distraen y complican las pruebas.
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          border: { color: INSIGHT_PALETTE.line },
          ticks: { color: INSIGHT_PALETTE.muted, font: { size: 10.5 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: INSIGHT_PALETTE.line },
          border: { display: false },
          ticks: { color: INSIGHT_PALETTE.faint, font: { size: 10 }, precision: 0 },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // «N tunes · X %»: el recuento y su peso sobre el universo. El
            // porcentaje sale del modelo para los tramos y se compone aquí para
            // `sin registro`, que no lleva uno propio.
            label: (item) => {
              const index = item.dataIndex;
              if (index === 0) {
                const count = props.histogram.sinRegistro;
                return `${count} ${count === 1 ? 'tune' : 'tunes'} · ${pctText(
                  sharePct(count, props.histogram.universe),
                )}`;
              }
              const bucket = props.histogram.buckets[index - 2];
              if (!bucket) return '';
              return `${bucket.count} ${bucket.count === 1 ? 'tune' : 'tunes'} · ${pctText(
                bucket.pct,
              )}`;
            },
          },
        },
      },
    },
  }));

  const summary = () =>
    `Days since the last practice: ${props.histogram.universe} tunes in rotation, ` +
    `${props.histogram.sinRegistro} with no record, ${props.histogram.overdue} overdue.`;

  return (
    <figure class="insight-card insight-card--overdue">
      <figcaption class="insight-head">
        <h2>Days since the last practice</h2>
        <span class="insight-note">{props.histogram.universe} in rotation</span>
      </figcaption>

      <Show
        when={props.histogram.universe > 0}
        fallback={
          <p class="insights-empty">
            No tune is in rotation yet, so there is nothing to weigh. Start one from the backlog
            and it will show up here.
          </p>
        }
      >
        <div class="insight-chart">
          <ChartCanvas config={config()} label={summary()} />
        </div>

        <Show
          when={props.delta.enoughHistory}
          fallback={<p class="insight-delta insight-delta--none">No history yet</p>}
        >
          <p class="insight-delta">
            <b>{pctText(props.delta.currentPct)}</b> overdue
            <span class="sub-sep">·</span>
            {signedPpText(props.delta.deltaPp)} vs {previousSundayLabel(props.nowMs)}
          </p>
        </Show>
      </Show>
    </figure>
  );
}
