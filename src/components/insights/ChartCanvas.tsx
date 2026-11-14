import { createEffect, onCleanup } from 'solid-js';
import type { Chart } from 'chart.js';
import { drawChart, type InsightChartConfig } from '../../lib/charts';

/**
 * El canvas de una gráfica del panel (#22): el único sitio donde se llama a
 * `drawChart`.
 *
 * Tres reglas que resuelve tenerlo en un solo componente:
 *   · **Una instancia viva, nunca dos.** Cada cambio de configuración —el rango
 *     del historial es el caso— destruye la anterior antes de pintar la nueva.
 *   · **Nada se pinta sin canvas.** Con `config` vacío no se llega aquí: los
 *     componentes enseñan su texto y no montan este nodo.
 *   · **El nombre accesible va en el `<canvas>`** (`role="img"`), porque una
 *     gráfica sin resumen es decoración para quien no la ve.
 */
export default function ChartCanvas(props: { config: InsightChartConfig; label: string }) {
  let canvas: HTMLCanvasElement | undefined;
  let chart: Chart | undefined;

  // `createEffect` y no `onMount`: al montar pinta, y cuando la configuración
  // cambia (el rango) vuelve a pintar sobre el mismo canvas.
  createEffect(() => {
    const config = props.config;
    if (!canvas) return;
    chart?.destroy();
    chart = drawChart(canvas, config);
  });

  onCleanup(() => {
    chart?.destroy();
    chart = undefined;
  });

  return <canvas ref={canvas} class="insight-canvas" role="img" aria-label={props.label} />;
}
