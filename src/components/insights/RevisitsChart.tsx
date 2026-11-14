import { Show, createMemo } from 'solid-js';
import type { RevisitSummary } from '../../lib/insights';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';
import { pctText } from './format';

/**
 * Las revisitas (#22): el hueco entre dos pasadas de la misma tune, medido
 * **contra el intervalo de su peldaño** (`hueco / objetivo`), que es lo único
 * que se puede comparar entre una cima y algo que se está aprendiendo.
 *
 * Los cuatro tramos son los del modelo (`<0.5× · 0.5–1× · 1–2× · ≥2×`) y las tres
 * cifras de debajo son otra lectura de los mismos huecos: demasiado pronto, en
 * banda y tarde. No cuadran una a una con las barras a propósito —«tarde» suma
 * los dos últimos tramos— y por eso van separadas y con su nombre, en vez de
 * pintarse como una segunda barra que parecería lo mismo.
 *
 * El tramo «en banda» va en tinta de acento y los demás en gris: la gráfica
 * existe para ver cuánto cae donde debe caer.
 */
export default function RevisitsChart(props: { summary: RevisitSummary }) {
  /** Índice del tramo que cumple el intervalo (`0.5–1×`). */
  const IN_BAND = 1;

  const bucketColors = createMemo(() =>
    props.summary.buckets.map((_, index) =>
      index === IN_BAND ? INSIGHT_PALETTE.accent : INSIGHT_PALETTE.faint,
    ),
  );

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'bar',
    data: {
      labels: props.summary.buckets.map((bucket) => bucket.label),
      datasets: [
        {
          type: 'bar',
          label: 'Revisits',
          data: props.summary.buckets.map((bucket) => bucket.count),
          backgroundColor: bucketColors(),
          borderRadius: 2,
          maxBarThickness: 46,
        },
      ],
    },
    options: {
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
            label: (item) => {
              const bucket = props.summary.buckets[item.dataIndex];
              if (!bucket) return '';
              return `${bucket.count} ${bucket.count === 1 ? 'gap' : 'gaps'} · ${pctText(bucket.pct)}`;
            },
          },
        },
      },
    },
  }));

  /** La mediana se lee en horas; sin pares no hay mediana que enseñar. */
  const medianText = () =>
    props.summary.medianHours === null ? '—' : `${props.summary.medianHours.toFixed(1)} h`;

  const summary = () =>
    `Revisits against the level interval: ${props.summary.pairs} gaps, ` +
    `${props.summary.inBand} in band, median ${medianText()}.`;

  return (
    <figure class="insight-card insight-card--revisits">
      <figcaption class="insight-head">
        <h2>Gap between passes</h2>
        <span class="insight-note">against the interval of each level</span>
      </figcaption>

      <Show
        when={props.summary.pairs > 0}
        fallback={
          <p class="insights-empty">
            No two passes of the same tune yet — the first revisit will show up here.
          </p>
        }
      >
        <div class="insight-chart">
          <ChartCanvas config={config()} label={summary()} />
        </div>

        <ul class="insight-counts">
          <li>
            <b>{props.summary.tooSoon}</b>
            <small>too soon</small>
          </li>
          <li class="is-in-band">
            <b>{props.summary.inBand}</b>
            <small>in band</small>
          </li>
          <li>
            <b>{props.summary.late}</b>
            <small>late</small>
          </li>
          <li>
            <b>{medianText()}</b>
            <small>median gap</small>
          </li>
        </ul>
      </Show>
    </figure>
  );
}
