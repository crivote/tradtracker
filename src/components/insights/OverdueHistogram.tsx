import { Show, createMemo } from 'solid-js';
import type { OverdueDelta, OverdueHistogram as Histogram } from '../../lib/insights';
import { previousSundayLabel } from '../../lib/insights-view';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';
import { pctText, signedPpText } from './format';

/**
 * El histograma del vencimiento (#22): cuántos días lleva cada tune en rotación
 * sin tocarse, y qué se ha pasado ya del intervalo de su peldaño.
 *
 * Dos cambios del corte #65, con su porqué:
 *
 *   · **`sin registro` sale de la gráfica.** Era la misma cifra de la tarjeta,
 *     repetida en una barra gris que además desvirtuaba el eje (71 tunes
 *     ausentes aplastaban los tramos reales). Su sitio es una cifra con su
 *     denominador; aquí solo va lo que tiene día, y el porcentaje de cada tramo
 *     se mide sobre esas tunes: los siete tramos suman el 100 % de lo pintado.
 *     La cabecera dice cuántas quedan fuera, para que el 100 % no engañe.
 *   · **Dos tramos más**: `61–90` y `90+`. El tramo viejo había acumulado 143
 *     tunes y una sola barra no distingue «un trimestre sin tocar» de «dos años».
 *
 * Debajo va el delta contra el domingo de la semana pasada, en **recuentos sobre
 * el mismo censo** —las mismas tunes, entonces y hoy—: el pie decía 79.1 % donde
 * la tarjeta decía 68.9 %, y eran dos denominadores distintos con la misma
 * palabra. Un recuento no admite doble lectura; el porcentaje de referencia va
 * en la tarjeta, con su denominador escrito.
 */
export default function OverdueHistogram(props: {
  histogram: Histogram;
  delta: OverdueDelta;
  /** Instante de la vista: fecha el domingo con el que se compara. */
  nowMs: number;
}) {
  /** Las que se pueden juzgar: el universo menos las que no tienen registro. */
  const judged = createMemo(() => Math.max(0, props.histogram.universe - props.histogram.sinRegistro));

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'bar',
    data: {
      labels: props.histogram.buckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Tunes',
          data: props.histogram.buckets.map((bucket) => bucket.count),
          backgroundColor: props.histogram.buckets.map(() => INSIGHT_PALETTE.accent),
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
            // «N tunes · X %»: el recuento y su peso sobre las que tienen día.
            label: (item) => {
              const bucket = props.histogram.buckets[item.dataIndex];
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
    `Days since the last practice: ${judged()} tunes with a record, ` +
    `${props.histogram.overdue} overdue, ${props.histogram.sinRegistro} without a record.`;

  const deltaText = () =>
    `${props.delta.previousOverdue} of ${props.delta.census} overdue on ` +
    `${previousSundayLabel(props.nowMs)} → ${props.delta.currentOverdue} today`;

  return (
    <figure class="insight-card insight-card--overdue">
      <figcaption class="insight-head">
        <h2>Days since the last practice</h2>
        <span class="insight-note">
          {judged()} with a record · {props.histogram.sinRegistro} without
        </span>
      </figcaption>

      <Show
        when={judged() > 0}
        fallback={
          <p class="insights-empty">
            No tune in rotation has a practice recorded yet, so there is nothing to weigh. Mark one
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
            {deltaText()}
            {' '}
            <span class="sub-sep">·</span>
            {' '}
            <b>{signedPpText(props.delta.deltaPp)}</b>
          </p>
        </Show>
      </Show>
    </figure>
  );
}
