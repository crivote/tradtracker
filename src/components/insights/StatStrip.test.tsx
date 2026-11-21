// @vitest-environment jsdom
/**
 * Las cuatro cifras del panel (#22, revisadas en #65). Se prueban por lo que se
 * lee —el número, su etiqueta y la nota de la racha—, no por el dibujo:
 * `drawChart` va simulado en todo el directorio porque jsdom no tiene canvas
 * (regla de arquitectura del corte).
 *
 * La regla del corte: **cada porcentaje dice su denominador**. El de vencidas
 * iba sin él y se leía como el 79.1 % del pie de la gráfica, que divide por otro
 * censo.
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
    { key: '0-3', label: '0–3', count: 4, pct: 26.7 },
    { key: '4-7', label: '4–7', count: 3, pct: 20 },
    { key: '8-14', label: '8–14', count: 2, pct: 13.3 },
    { key: '15-30', label: '15–30', count: 3, pct: 20 },
    { key: '31-60', label: '31–60', count: 2, pct: 13.3 },
    { key: '61-90', label: '61–90', count: 1, pct: 6.7 },
    { key: '90+', label: '90+', count: 0, pct: 0 },
  ],
  byBand: [
    { band: 'shaky', practiced: 4, overdue: 2, pct: 50 },
    { band: 'playing_along', practiced: 4, overdue: 1, pct: 25 },
    { band: 'solo_ready', practiced: 4, overdue: 1, pct: 25 },
    { band: 'mastered', practiced: 3, overdue: 1, pct: 33.3 },
  ],
  overdue: 5,
  overduePct: 33.3,
  aside: { learning: 3, backlog: 0, shelved: 0 },
  intervals: { shaky: 4, playing_along: 7, solo_ready: 14, mastered: 30 },
};

const STREAK = { current: 3, best: 27, previous: 9 };

/** Lo que se lee en cada cifra: el número en negrita y su etiqueta. */
function figures(): Array<{ value: string; label: string }> {
  return Array.from(document.querySelectorAll('.insights-stats .stat')).map((node) => ({
    value: node.querySelector('b')!.textContent!.trim(),
    label: node.querySelector('small')!.textContent!.trim(),
  }));
}

afterEach(() => cleanup());

describe('StatStrip', () => {
  it('pinta las cuatro cifras con su porcentaje, su etiqueta y el denominador de las vencidas', () => {
    render(() => <StatStrip histogram={HISTOGRAM} alive={9} streak={STREAK} />);

    expect(figures()).toEqual([
      // Las vencidas dicen sobre cuántas se miden: 5 de las 15 con día.
      { value: '5', label: 'overdue · 33.3% of 15' },
      { value: '9', label: 'alive · 14 days' },
      { value: '3', label: 'day streak' },
      // 5 de 20 en rotación: la participación se compone aquí, no la inventa el modelo.
      { value: '5', label: 'no record · 25.0%' },
    ]);
  });

  it('la racha trae la mejor y la anterior: una racha sin espejo motiva poco', () => {
    render(() => <StatStrip histogram={HISTOGRAM} alive={9} streak={STREAK} />);

    const note = document.querySelector('.insights-stats .stat-note')!;
    expect(note.textContent!.replace(/\s+/g, ' ').trim()).toBe('best 27 · last 9');
  });

  it('sin racha en curso, la nota enseña la última que hubo y no un «last» vacío', () => {
    render(() => (
      <StatStrip histogram={HISTOGRAM} alive={0} streak={{ current: 0, best: 27, previous: 5 }} />
    ));

    expect(document.querySelector('.insights-stats .stat-note')!.textContent!.trim()).toBe(
      'best 27 · last 5'
    );
  });

  it('sin ninguna racha lo dice, en vez de enseñar un cero disfrazado de récord', () => {
    render(() => (
      <StatStrip histogram={HISTOGRAM} alive={0} streak={{ current: 0, best: 0, previous: 0 }} />
    ));

    expect(document.querySelector('.insights-stats .stat-note')!.textContent!.trim()).toBe(
      'no run yet'
    );
  });

  it('las cifras no son enlaces: no hay ruta por «sin registro» ni por «vivas»', () => {
    render(() => <StatStrip histogram={HISTOGRAM} alive={9} streak={STREAK} />);

    const section = document.querySelector('.insights-stats')!;
    expect(section.querySelectorAll('a')).toHaveLength(0);
    expect(section.querySelectorAll('button')).toHaveLength(0);
  });

  it('sin nada en rotación lo dice y no pinta cuatro ceros', () => {
    render(() => (
      <StatStrip
        histogram={{ ...HISTOGRAM, universe: 0, sinRegistro: 0, overdue: 0, overduePct: 0 }}
        alive={0}
        streak={{ current: 0, best: 0, previous: 0 }}
      />
    ));

    expect(figures()).toHaveLength(0);
    expect(document.querySelector('.insights-empty')!.textContent).toContain(
      'Nothing in rotation yet',
    );
  });
});
