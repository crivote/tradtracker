import { For, Show, createMemo } from 'solid-js';
import type { HistoryPoint } from '../lib/practice-history';

/**
 * La gráfica del historial: una barra por **día del rango**, con ceros incluidos.
 *
 * Es CSS y no SVG a propósito. Una serie de 90 días con `viewBox` escalable
 * deforma el texto y obliga a calcular posiciones a mano; con barras flex, el día
 * vacío ocupa su sitio —que es justo lo que enseña el ritmo— y el ancho se adapta
 * sin una sola medida. Cada barra lleva su `title` para el detalle exacto, y la
 * figura entera un `aria-label` con el resumen, porque una gráfica sin resumen es
 * decoración para quien no la ve.
 *
 * La métrica es **tunes ensayadas**, no sesiones: el gesto «Practise» abre una
 * sesión por toque, así que contar sesiones mediría el gesto y no el trabajo.
 */
export default function PracticeChart(props: { points: HistoryPoint[]; range: number }) {
  const max = createMemo(() =>
    props.points.reduce((top, point) => Math.max(top, point.practices), 0),
  );

  const total = createMemo(() =>
    props.points.reduce((sum, point) => sum + point.practices, 0),
  );

  /** Altura relativa; el día sin ensayo deja una marca de 2 px, no desaparece. */
  const height = (practices: number): string => {
    if (practices === 0) return '2px';
    const ratio = practices / Math.max(1, max());
    return `max(6px, ${Math.round(ratio * 100)}%)`;
  };

  const summary = createMemo(
    () =>
      `Practices per day over the last ${props.range} days: ${total()} in total, ` +
      `peak ${max()} in a day.`,
  );

  return (
    <figure class="history-chart">
      <div class="chart-bars" role="img" aria-label={summary()}>
        <For each={props.points}>
          {(point) => (
            <span
              class="chart-bar"
              classList={{ 'is-empty': point.practices === 0, 'is-today': point.isToday }}
              style={{ height: height(point.practices) }}
              data-count={point.practices}
              title={`${point.label} — ${point.practices} ${
                point.practices === 1 ? 'practice' : 'practices'
              }`}
            >
              <span class="chart-bar__fill" />
            </span>
          )}
        </For>
      </div>

      <figcaption class="chart-axis">
        <span>{props.points[0]?.label ?? ''}</span>
        <Show when={props.points.length > 4}>
          <span class="chart-axis__mid">
            {props.points[Math.floor(props.points.length / 2)]?.label ?? ''}
          </span>
        </Show>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
