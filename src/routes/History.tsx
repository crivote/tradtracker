import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { A } from '@solidjs/router';
import {
  DEFAULT_HISTORY_RANGE,
  HISTORY_RANGES,
  buildHistoryDays,
  dayLabel,
  fetchPracticeHistory,
  historySeries,
  historyStats,
  type HistoryDay,
  type HistoryRange,
  type PracticeMark,
} from '../lib/practice-history';
import PracticeChart from '../components/PracticeChart';
import './repertoire.css';
import './history.css';

/**
 * Historial de ensayos (`/history`).
 *
 * Hasta este corte, lo practicado solo se veía **tune a tune** —la fecha en la
 * ficha y el contador de la carta— y el conjunto no existía en ninguna pantalla.
 * La pregunta que esta página responde es la del día: qué se tocó, cuándo, cuánto
 * y qué tal salió.
 *
 * Tres decisiones de lectura:
 *   · **Por día**, que ya viene local de la base: desde #56 una marca es la tune
 *     y el día (`pr_practice.day`), no una línea dentro de una sesión. La pantalla
 *     no convierte instantes ni compone husos.
 *   · **La métrica de la gráfica son tunes ensayadas.** Cada marca es una tune
 *     tocada; no hay «sesiones» que contar, y contarlas mediría el gesto en vez
 *     del trabajo.
 *   · **Los días sin ensayo se pintan con cero.** El hueco es el dato: un rango
 *     de siete barras llenas y tres vacías dice más que una lista de días con
 *     actividad.
 *
 * La página es de solo lectura: se apunta desde la lista, la carta, el taller o
 * la ficha, y cada una recarga lo suyo. Aquí no hay gesto que escriba.
 */
export default function History() {
  /**
   * Un solo instante para toda la pantalla: el rango, la etiqueta «Today» y el
   * eje de la gráfica tienen que hablar del mismo día. Se refresca al cambiar de
   * rango, que es cuando la vista vuelve a leer.
   */
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [range, setRange] = createSignal<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const [marks, setMarks] = createSignal<PracticeMark[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const load = async (value: HistoryRange) => {
    setLoading(true);
    setError(null);
    const at = Date.now();
    setNowMs(at);
    try {
      setMarks(await fetchPracticeHistory({ nowMs: at, range: value }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  // El rango es la única entrada de la pantalla: cambiarlo vuelve a leer, y al
  // montar deja el efecto hacer la primera carga.
  createEffect(() => {
    void load(range());
  });

  const days = createMemo(() => buildHistoryDays(marks()));
  const stats = createMemo(() => historyStats(days(), { nowMs: nowMs(), range: range() }));
  const points = createMemo(() => historySeries(days(), { nowMs: nowMs(), range: range() }));

  const rangeLabel = (value: HistoryRange) => `${value} days`;

  /** «4 of 30» sin repetir la unidad en la etiqueta de la cifra. */
  const activeLabel = () => `${stats().activeDays} of ${range()}`;

  return (
    <div class="repertoire-home history">
      <header class="page-head">
        <div>
          <h1>Practice history</h1>
          <p class="sub">
            <Show when={!loading()} fallback="Loading your practice…">
              <b>{stats().practices}</b> {stats().practices === 1 ? 'practice' : 'practices'} in
              the last {rangeLabel(range())}
              <span class="sub-sep">·</span>
              <b>{stats().distinctTunes}</b>{' '}
              {stats().distinctTunes === 1 ? 'tune' : 'different tunes'}
              <span class="sub-sep">·</span>
              <A href="/practice">Back to today's list</A>
            </Show>
          </p>
        </div>

        <div class="head-tools">
          <div class="history-range" role="group" aria-label="Range">
            <For each={HISTORY_RANGES}>
              {(value) => (
                <button
                  type="button"
                  classList={{ 'is-on': range() === value }}
                  aria-pressed={range() === value}
                  onClick={() => setRange(value)}
                >
                  {rangeLabel(value)}
                </button>
              )}
            </For>
          </div>
        </div>
      </header>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
        <button type="button" class="history-retry" onClick={() => void load(range())}>
          Try again
        </button>
      </Show>

      <Show when={!error()}>
        <Show when={!loading()} fallback={<p class="notice">Loading the history…</p>}>
          <section class="history-figures" aria-label="Summary">
            <div class="figure">
              <b>{stats().practices}</b>
              <small>practices</small>
            </div>
            <div class="figure">
              <b>{activeLabel()}</b>
              <small>active days</small>
            </div>
            <div class="figure">
              <b>{stats().streak > 0 ? `${stats().streak} ${stats().streak === 1 ? 'day' : 'days'}` : '—'}</b>
              <small>streak</small>
            </div>
            <div class="figure">
              <b>{stats().avgQuality === null ? '—' : `${stats().avgQuality!.toFixed(1)} / 5`}</b>
              <small>
                average
                <Show when={stats().ratedCount > 0}> · {stats().ratedCount} rated</Show>
              </small>
            </div>
          </section>

          <Show when={points().length > 0}>
            <PracticeChart points={points()} range={range()} />
          </Show>

          <Show
            when={days().length > 0}
            fallback={
              <p class="history-empty">
                Nothing recorded in the last {rangeLabel(range())}.{' '}
                <A href="/practice">Work through today's list</A> and the practices will show up
                here.
              </p>
            }
          >
            <section class="history-days" aria-label="Practices by day">
              <For each={days()}>{(day) => <HistoryDayBlock day={day} nowMs={nowMs()} />}</For>
            </section>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** Un día: su fecha, su recuento y las tunes que se tocaron. */
function HistoryDayBlock(props: { day: HistoryDay; nowMs: number }) {
  return (
    <article class="history-day">
      <header>
        <h2>{dayLabel(props.day.key, props.nowMs)}</h2>
        <p>
          {props.day.practices} {props.day.practices === 1 ? 'practice' : 'practices'}
          <Show when={props.day.avgQuality !== null}>
            <span class="sub-sep">·</span>avg {props.day.avgQuality!.toFixed(1)}
          </Show>
        </p>
      </header>

      <ul>
        <For each={props.day.entries}>
          {(entry) => (
            <li>
              <div class="history-line">
                <A class="history-title" href={`/repertoire/${entry.repertoireId}`}>
                  {entry.title}
                </A>
                <Rating quality={entry.quality} />
              </div>
              <Show when={entry.rhythm}>
                <p class="history-meta">{entry.rhythm}</p>
              </Show>
              <Show when={entry.comment}>
                {(comment) => <p class="history-comment">{comment()}</p>}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </article>
  );
}

/**
 * La valoración de un ensayo. Sin puntuar se dice con palabras: cinco estrellas
 * vacías en cada línea de una lista larga son ruido, y un ensayo sin puntuar es
 * el caso normal, no una excepción.
 */
function Rating(props: { quality: number | null }) {
  return (
    <Show
      when={props.quality}
      fallback={<span class="history-unrated">not rated</span>}
    >
      {(quality) => (
        <span class="history-stars" aria-label={`${quality()} of 5`}>
          <For each={[1, 2, 3, 4, 5]}>
            {(value) => (
              <span aria-hidden="true" classList={{ on: value <= quality() }}>
                ★
              </span>
            )}
          </For>
        </span>
      )}
    </Show>
  );
}
