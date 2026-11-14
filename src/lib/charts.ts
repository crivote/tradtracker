/**
 * La única puerta a Chart.js del panel de estado (#22).
 *
 * Existe por una razón de pruebas, no de dibujo: **jsdom no tiene canvas** y
 * cualquier test que instancie `Chart` revienta al pedir el contexto 2D. Con el
 * dibujo aislado en esta función, cada componente pinta su `<canvas>` y llama
 * aquí, y las pruebas hacen `vi.mock('../../lib/charts')` para mirar la
 * **configuración** —cifras, etiquetas, colores, la línea del plan— sin tocar
 * un canvas que no existe.
 *
 * Los componentes se registran **a mano y una sola vez**: el paquete «auto» de
 * Chart.js arrastraría los diez controladores, las cuatro escalas y todos
 * los plugins al bundle para pintar cuatro gráficas de barras. Aquí van los tres
 * controladores que se usan (barras, líneas y puntos), dos escalas, el tooltip y
 * la leyenda —la leyenda es interacción, no decoración: enciende y apaga
 * peldaños—.
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

/**
 * Lo que aceptan las cuatro gráficas: barras y, en el ritmo, una línea encima
 * para el plan del día. Se declara aquí para que la instancia y los componentes
 * hablen del mismo tipo.
 */
export type InsightChartConfig = ChartConfiguration<'bar' | 'line'>;

/** Registro perezoso: la primera gráfica paga el registro, no el import. */
let registered = false;

function registerComponents(): void {
  if (registered) return;
  Chart.register(
    BarController,
    BarElement,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
  );
  registered = true;
}

/**
 * Pinta `config` en `canvas` y devuelve la instancia. Quien llama es responsable
 * de destruirla (`chart.destroy()`), porque una instancia viva sobre un canvas
 * desmontado sigue escuchando eventos.
 */
export function drawChart(canvas: HTMLCanvasElement, config: InsightChartConfig): Chart {
  registerComponents();
  return new Chart(canvas, config);
}
