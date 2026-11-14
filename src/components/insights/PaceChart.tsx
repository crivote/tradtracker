import { Show, createMemo } from 'solid-js';
import type { HistoryPoint } from '../../lib/practice-history';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';

/**
 * El ritmo del historial (#22): tunes **distintas** por día en el rango elegido
 * (7/30/90) y, encima, la línea del **plan** del propio usuario (`dailyTarget`).
 *
 * La métrica es tunes, no marcas ni gestos: dos toques de la misma tune el mismo
 * día son una tune. Los días sin ensayo van a cero y conservan su carril —el
 * hueco es el dato, igual que en el historial—; sólo cuando no hay ni un ensayo
 * en el rango se dice con palabras, porque una fila de ceros no informa de nada.
 *
 * La línea del plan va en el mismo eje a propósito: la pregunta no es «cuánto he
 * tocado» sino «cuánto he tocado contra lo que me propuse».
 */
export default function PaceChart(props: {
  points: HistoryPoint[];
  /** Días del rango (7/30/90): titula la tarjeta y la serie. */
  range: number;
  /** Objetivo diario de las preferencias del usuario. */
  dailyTarget: number;
  /** Tunes distintas con marca en los últimos 14 días. */
  alive: number;
}) {
  const total = createMemo(() => props.points.reduce((sum, point) => sum + point.practices, 0));

  /** El día de hoy se marca con la tinta, no con el acento: se busca de un vistazo. */
  const barColors = createMemo(() =>
    props.points.map((point) => (point.isToday ? INSIGHT_PALETTE.ink : INSIGHT_PALETTE.accent)),
  );

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'bar',
    data: {
      labels: props.points.map((point) => point.label),
      datasets: [
        {
          type: 'bar',
          label: 'Tunes',
          data: props.points.map((point) => point.practices),
          backgroundColor: barColors(),
          borderRadius: 2,
          maxBarThickness: 22,
        },
        {
          // El plan es una raya, no una serie de datos: sin puntos y discontinua,
          // para que no se confunda con lo practicado.
          type: 'line',
          label: `Plan · ${props.dailyTarget} a day`,
          data: props.points.map(() => props.dailyTarget),
          borderColor: INSIGHT_PALETTE.muted,
          borderWidth: 1,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
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
          ticks: {
            color: INSIGHT_PALETTE.muted,
            font: { size: 10.5 },
            // Con 90 días no caben 90 etiquetas: el eje se auto-omite.
            autoSkip: true,
            maxTicksLimit: 10,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: INSIGHT_PALETTE.line },
          border: { display: false },
          ticks: { color: INSIGHT_PALETTE.faint, font: { size: 10 }, precision: 0 },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: INSIGHT_PALETTE.muted, boxWidth: 10, font: { size: 10.5 } },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const count = item.parsed.y ?? 0;
              return item.datasetIndex === 1
                ? `Plan · ${count} a day`
                : `${count} ${count === 1 ? 'tune' : 'tunes'}`;
            },
          },
        },
      },
    },
  }));

  const summary = () =>
    `Tunes practiced per day over the last ${props.range} days: ${total()} in total, ` +
    `plan ${props.dailyTarget} a day.`;

  return (
    <figure class="insight-card insight-card--pace">
      <figcaption class="insight-head">
        <h2>Tunes a day</h2>
        <span class="insight-note">last {props.range} days against the plan</span>
      </figcaption>

      <Show
        when={props.points.length > 0 && total() > 0}
        fallback={
          <p class="insights-empty">
            No practices in the last {props.range} days. The plan line will show up as soon as one
            lands.
          </p>
        }
      >
        <div class="insight-chart">
          <ChartCanvas config={config()} label={summary()} />
        </div>
      </Show>

      <p class="insight-foot">
        <b>{props.alive}</b> {props.alive === 1 ? 'tune' : 'tunes'} alive in the last 14 days
      </p>
    </figure>
  );
}
