import { For, Show, createMemo } from 'solid-js';
import { A } from '@solidjs/router';
import type { InsightChartConfig } from '../../lib/charts';
import ChartCanvas from './ChartCanvas';
import { INSIGHT_PALETTE } from './palette';
import { pctText, sharePct } from './format';

/** Un sector del reparto: qué nivel, cuántas tunes y a dónde lleva su puerta. */
export interface LevelShareEntry {
  /** `to_learn`, `learning`, `shaky`… o `shelved`. */
  key: string;
  label: string;
  count: number;
  /** La pantalla de ese nivel: cada sector es también una puerta. */
  href: string;
}

/** El color de un sector: la rampa de peldaños y, fuera de ella, sus dos grises. */
function colorOf(key: string): string {
  if (key === 'shelved') return INSIGHT_PALETTE.shelved;
  if (key === 'to_learn') return INSIGHT_PALETTE.backlog;
  const band = INSIGHT_PALETTE.bands[key as keyof typeof INSIGHT_PALETTE.bands];
  return band ?? INSIGHT_PALETTE.unknown;
}

/**
 * El reparto del repertorio por nivel, en donut (#65). Sustituye a la línea de
 * texto que enumeraba los recuentos: con siete cifras seguidas, el peso relativo
 * de cada nivel no se ve.
 *
 * Dos decisiones:
 *
 *   · **La leyenda es HTML y cada fila es una puerta.** La leyenda de Chart.js
 *     enciende y apaga sectores; aquí lo que se quiere es ir a las tunes de ese
 *     nivel, que es lo que hacían los enlaces de la línea de texto. Se conserva
 *     el porcentaje al lado del recuento: el sector da la forma, la fila da la
 *     cifra exacta.
 *   · **Los sectores a cero no se pintan** pero sí aparecen en la leyenda: un
 *     nivel vacío es información («no hay nada en solo-ready»), y una fila de
 *     leyenda que cambia de sitio según los datos mueve la lectura.
 */
export default function LevelShare(props: {
  entries: LevelShareEntry[];
  /** Total del repertorio de mantenimiento: el número del centro. */
  total: number;
  /**
   * Lo que **no** es repertorio —backlog, taller, cajón—: se pinta aparte, con
   * su propio rótulo y sin entrar en el donut ni en el total del centro.
   */
  aside?: LevelShareEntry[];
}) {
  const drawn = createMemo(() =>
    props.entries.filter((entry) => entry.count > 0).map((entry) => ({
      ...entry,
      color: colorOf(entry.key),
    })),
  );

  const config = createMemo<InsightChartConfig>(() => ({
    type: 'doughnut',
    data: {
      labels: drawn().map((entry) => entry.label),
      datasets: [
        {
          data: drawn().map((entry) => entry.count),
          backgroundColor: drawn().map((entry) => entry.color),
          // El hueco entre sectores es el papel, no un borde blanco: así el donut
          // se lee sobre `.repertoire-home` y no sobre un blanco que no existe.
          borderColor: INSIGHT_PALETTE.paper,
          borderWidth: 2,
          hoverOffset: 2,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) =>
              `${item.label}: ${item.formattedValue} · ${pctText(
                sharePct(Number(item.formattedValue), props.total),
              )}`,
          },
        },
      },
    },
  }));

  const summary = () =>
    props.entries
      .filter((entry) => entry.count > 0)
      .map((entry) => `${entry.count} ${entry.label.toLowerCase()}`)
      .join(', ');

  return (
    <figure class="level-share">
      <div class="level-donut">
        <ChartCanvas config={config()} label={`${props.total} tunes: ${summary()}.`} />
        <span class="level-total" aria-hidden="true">
          <b>{props.total}</b>
          <small>tunes</small>
        </span>
      </div>

      <Show when={props.entries.length > 0}>
        <ul class="level-legend">
          <For each={props.entries}>
            {(entry) => (
              <li classList={{ 'is-empty': entry.count === 0 }}>
                <A href={entry.href}>
                  <i style={{ background: colorOf(entry.key) }} aria-hidden="true" />
                  <span class="lvl">{entry.label}</span>
                  <b>{entry.count}</b>
                  <span class="pct">{pctText(sharePct(entry.count, props.total))}</span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.aside && props.aside.length > 0}>
        <div class="level-aside">
          <p class="level-aside__title">Outside the repertoire</p>
          <ul>
            <For each={props.aside}>
              {(entry) => (
                <li>
                  <A href={entry.href}>
                    <i style={{ background: colorOf(entry.key) }} aria-hidden="true" />
                    <span class="lvl">{entry.label}</span>
                    <b>{entry.count}</b>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </figure>
  );
}
