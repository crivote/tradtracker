import { Show, createMemo } from 'solid-js';
import type { OverdueTrend } from '../../lib/insights';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';

/**
 * La tendencia del vencimiento (#65): cuántas tunes se pasaban de su intervalo
 * **cada día**, para ver si se gana o se pierde terreno.
 *
 * Va al lado del histograma y no encima de él: el eje de la distribución son
 * tramos de antigüedad, no días, y una línea ahí sería una curva acumulada, no
 * una tendencia. Aquí el eje es el tiempo.
 *
 * La serie empieza donde empieza la historia de la escalera —el primer evento
 * `status`, finales de octubre en esta base— y la cabecera lo dice con la fecha.
 * Rellenar hacia atrás con el peldaño de hoy sería inventar un pasado.
 */
export default function OverdueTrendChart(props: { trend: OverdueTrend }) {
  const config = createMemo<InsightChartConfig>(() => ({
    type: 'line',
    data: {
      labels: props.trend.points.map((point) => point.label),
      datasets: [
        {
          label: 'Overdue',
          data: props.trend.points.map((point) => point.overdue),
          borderColor: INSIGHT_PALETTE.accent,
          backgroundColor: INSIGHT_PALETTE.accent,
          borderWidth: 1.6,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: 0.25,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { display: false },
          border: { color: INSIGHT_PALETTE.line },
          // Dieciséis días de etiqueta no caben sin pisarse: se enseña una de cada
          // tres y el tooltip da el día exacto.
          ticks: { color: INSIGHT_PALETTE.muted, font: { size: 10.5 }, maxRotation: 0, autoSkip: true },
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
            // «N of M overdue»: el recuento sin el censo es una cifra a medias.
            label: (item) => {
              const point = props.trend.points[item.dataIndex];
              if (!point) return '';
              return `${point.overdue} of ${point.judged} overdue`;
            },
          },
        },
      },
    },
  }));

  const last = () => props.trend.points.at(-1);

  const summary = () =>
    `Overdue by day: ${props.trend.points.length} days from ${props.trend.since ?? 'today'}` +
    (last() ? `, ${last()!.overdue} of ${last()!.judged} overdue today.` : '.');

  return (
    <figure class="insight-card insight-card--trend">
      <figcaption class="insight-head">
        <h2>Overdue, day by day</h2>
        <span class="insight-note">since {props.trend.since ?? '—'}</span>
      </figcaption>

      <Show
        when={props.trend.points.length > 1}
        fallback={
          <p class="insights-empty">
            The ladder has no history yet, so there is no trend to read. It starts building from the
            first level change.
          </p>
        }
      >
        <div class="insight-chart">
          <ChartCanvas config={config()} label={summary()} />
        </div>
      </Show>
    </figure>
  );
}
