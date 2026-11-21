import { Show, createMemo } from 'solid-js';
import type { OverdueTrend, OverdueTrendPoint } from '../../lib/insights';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';

/**
 * Tasa de vencimiento del día: `overdue / judged`, con un decimal.
 *
 * La serie se pinta en **porcentaje**, no en recuento: el censo crece según se
 * van conociendo peldaños y ensayos, así que una línea de absolutos mezcla
 * «envejecen las tunes» con «hay más tunes juzgadas» y una semana de trabajo
 * serio se lee como una línea plana. El recuento sigue en el tooltip, que es
 * donde no compite con el eje.
 */
function duePct(point: OverdueTrendPoint): number {
  if (point.judged === 0) return 0;
  return Math.round((point.overdue / point.judged) * 1000) / 10;
}

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
          label: 'Overdue %',
          data: props.trend.points.map(duePct),
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
          ticks: {
            color: INSIGHT_PALETTE.faint,
            font: { size: 10 },
            precision: 0,
            callback: (value) => `${value}%`,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // «N of M overdue · X %»: la tasa manda en la línea, pero el recuento
            // y su censo no se esconden.
            label: (item) => {
              const point = props.trend.points[item.dataIndex];
              if (!point) return '';
              return `${point.overdue} of ${point.judged} overdue · ${duePct(point)}%`;
            },
          },
        },
      },
    },
  }));

  const last = () => props.trend.points.at(-1);

  const summary = () =>
    `Overdue by day: ${props.trend.points.length} days from ${props.trend.since ?? 'today'}` +
    (last()
      ? `, ${last()!.overdue} of ${last()!.judged} overdue today (${duePct(last()!)}%).`
      : '.');

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
