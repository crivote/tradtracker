import { Show, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import {
  BANDS,
  type LadderStatus,
} from '../../lib/repertoire-model';
import type { WeekComposition } from '../../lib/insights';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE, bandColor } from './palette';

/** Los cinco peldaños en orden de escalera: es el orden de los datasets. */
const LADDER_BANDS: readonly LadderStatus[] = BANDS.map((band) => band.status as LadderStatus);

/**
 * La composición del repertorio por semana (#22): barras **apiladas** con los
 * cinco peldaños y, en gris, lo que aún no tenía estado registrado.
 *
 * Es la única gráfica del panel con dos interacciones, y las dos son de Chart.js:
 *   · **La leyenda enciende y apaga un peldaño.** No hay control propio: la
 *     leyenda de Chart.js ya lo hace y añadir un conmutador al lado sería el
 *     mismo gesto dos veces.
 *   · **Pinchar un segmento abre el listado de ese peldaño** (`/level/<band>`).
 *     El gris de `sinEstado` no navega: no hay listado de «no se sabe», y una
 *     barra que promete una pantalla y no la da es peor que una barra quieta.
 *
 * El gris no es un peldaño más y por eso va el último del apilado: abajo queda
 * la escalera —lo que se puede leer— y arriba lo que falta por saber.
 *
 * Si **todas** las semanas salen sin estado, se pinta igual (el gris es el dato:
 * la escalera no tiene historia anterior) y debajo se explica desde cuándo la
 * tiene, con la fecha del primer evento real, no con una constante.
 */
export default function CompositionChart(props: {
  weeks: WeekComposition[];
  /** `30 Oct` o `null`: primer día con estado registrado en la escalera. */
  ladderSince: string | null;
}) {
  const navigate = useNavigate();

  const hasKnownLevels = createMemo(() =>
    props.weeks.some((week) => LADDER_BANDS.some((band) => week.byBand[band] > 0)),
  );

  /** El universo de la última semana: si es cero no hay escalera que mirar. */
  const latestTotal = createMemo(() => props.weeks[props.weeks.length - 1]?.total ?? 0);

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'bar',
    data: {
      labels: props.weeks.map((week) => week.label),
      datasets: [
        ...LADDER_BANDS.map((band, index) => ({
          type: 'bar' as const,
          label: BANDS[index].label,
          data: props.weeks.map((week) => week.byBand[band]),
          backgroundColor: bandColor(band),
          stack: 'ladder',
          borderRadius: 2,
          maxBarThickness: 40,
        })),
        {
          type: 'bar' as const,
          label: 'No level yet',
          data: props.weeks.map((week) => week.sinEstado),
          backgroundColor: INSIGHT_PALETTE.unknown,
          stack: 'ladder',
          borderRadius: 2,
          maxBarThickness: 40,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_event, elements) => {
        const hit = elements[0];
        if (!hit) return;
        const band = LADDER_BANDS[hit.datasetIndex];
        // `sinEstado` (el sexto dataset) no es un peldaño: no lleva a ninguna parte.
        if (!band) return;
        navigate(`/level/${band}`);
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (!target || !target.style) return;
        const band = elements[0] ? LADDER_BANDS[elements[0].datasetIndex] : undefined;
        target.style.cursor = band ? 'pointer' : 'default';
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { color: INSIGHT_PALETTE.line },
          ticks: { color: INSIGHT_PALETTE.muted, font: { size: 10.5 } },
        },
        y: {
          stacked: true,
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
              const value = item.parsed.y ?? 0;
              return `${item.dataset.label}: ${value} ${value === 1 ? 'tune' : 'tunes'}`;
            },
          },
        },
      },
    },
  }));

  const summary = () =>
    `Repertoire by level, week by week: ${props.weeks.length} weeks, ` +
    `${latestTotal()} tunes on the last one.`;

  return (
    <figure class="insight-card insight-card--composition">
      <figcaption class="insight-head">
        <h2>Repertoire by level</h2>
        <span class="insight-note">last {props.weeks.length} weeks</span>
      </figcaption>

      <Show
        when={props.weeks.length > 0}
        fallback={<p class="insights-empty">No weeks to show yet.</p>}
      >
        <Show
          when={latestTotal() > 0}
          fallback={<p class="insights-empty">No tune has a level yet, so there is nothing to stack.</p>}
        >
          <div class="insight-chart">
            <ChartCanvas config={config()} label={summary()} />
          </div>

          <Show when={!hasKnownLevels()}>
            <p class="insight-foot insight-foot--note">
              {props.ladderSince
                ? `The ladder only has history since ${props.ladderSince} — before that no level was recorded, so every tune sits under “No level yet”.`
                : 'No level was recorded in these weeks, so every tune sits under “No level yet”.'}
            </p>
          </Show>
        </Show>
      </Show>
    </figure>
  );
}
