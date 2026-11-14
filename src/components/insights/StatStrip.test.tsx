// @vitest-environment jsdom
/**
 * Las cuatro cifras del panel (#22). Se prueban por lo que se lee —el número y
 * su etiqueta—, no por el dibujo: `drawChart` va simulado en todo el directorio
 * porque jsdom no tiene canvas (regla de arquitectura del corte).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import type { OverdueHistogram } from '../../lib/insights';
import StatStrip from './StatStrip';

/** Un universo de 20: 5 sin registro y 7 vencidas de las 15 con día. */
const HISTOGRAM: OverdueHistogram = {
  universe: 20,
  sinRegistro: 5,
  buckets: [
    { key: '0-3', label: '0–3', count: 4, pct: 20 },
    { key: '4-7', label: '4–7', count: 3, pct: 15 },
    { key: '8-14', label: '8–14', count: 2, pct: 10 },
    { key: '15-30', label: '15–30', count: 3, pct: 15 },
    { key: '31-60', label: '31–60', count: 2, pct: 10 },
    { key: '60+', label: '60+', count: 1, pct: 5 },
  ],
  byBand: [
    { band: 'learning', practiced: 3, overdue: 2, pct: 66.7 },
    { band: 'shaky', practiced: 3, overdue: 2, pct: 66.7 },
    { band: 'playing_along', practiced: 3, overdue: 1, pct: 33.3 },
    { band: 'solo_ready', practiced: 3, overdue: 1, pct: 33.3 },
    { band: 'mastered', practiced: 3, overdue: 1, pct: 33.3 },
  ],
  overdue: 7,
  overduePct: 46.7,
};

/** Lo que se lee en cada cifra: el número en negrita y su etiqueta. */
function figures(): Array<{ value: string; label: string }> {
  return Array.from(document.querySelectorAll('.insights-stats .stat')).map((node) => ({
    value: node.querySelector('b')!.textContent!.trim(),
    label: node.querySelector('small')!.textContent!.trim(),
  }));
}

afterEach(() => cleanup());

describe('StatStrip', () => {
  it('pinta las cuatro cifras con su porcentaje y su etiqueta corta', () => {
    render(() => <StatStrip histogram={HISTOGRAM} alive={9} streak={3} />);

    expect(figures()).toEqual([
      // 5 de 20 en rotación: la participación se compone aquí, no la inventa el modelo.
      { value: '5', label: 'no record · 25.0%' },
      // Las vencidas van sobre las que tienen día: el 46,7 % del modelo.
      { value: '7', label: 'overdue · 46.7%' },
      { value: '9', label: 'alive · 14 days' },
      { value: '3', label: 'day streak' },
    ]);
  });

  it('las cifras no son enlaces: no hay ruta por «sin registro» ni por «vivas»', () => {
    render(() => <StatStrip histogram={HISTOGRAM} alive={9} streak={3} />);

    const section = document.querySelector('.insights-stats')!;
    expect(section.querySelectorAll('a')).toHaveLength(0);
    expect(section.querySelectorAll('button')).toHaveLength(0);
  });

  it('sin nada en rotación lo dice y no pinta cuatro ceros', () => {
    render(() => (
      <StatStrip
        histogram={{ ...HISTOGRAM, universe: 0, sinRegistro: 0, overdue: 0, overduePct: 0 }}
        alive={0}
        streak={0}
      />
    ));

    expect(figures()).toHaveLength(0);
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'Nothing in rotation yet',
    );
  });
});
