import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
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
import { fetchRepertoire } from '../lib/repertoire';
import type { RepertoireRow } from '../lib/repertoire-model';
import { readPrefs } from '../lib/practice-storage';
import { useTuneHref } from '../lib/tune-back';
import {
  compositionByWeek,
  revisits,
  type InsightEvent,
  type InsightMark,
} from '../lib/insights';
import { fetchInsightEvents, fetchInsightMarks } from '../lib/insights-data';
import {
  aliveInRange,
  ladderHistorySince,
  paceSeries,
} from '../lib/insights-view';
import PracticeChart from '../components/PracticeChart';
import PaceChart from '../components/insights/PaceChart';
import CompositionChart from '../components/insights/CompositionChart';
import RevisitsChart from '../components/insights/RevisitsChart';
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

  /**
   * El panel (#22) es otra lectura de las mismas marcas y se carga **una vez al
   * montar**: ni el rango ni el cambio de día lo vuelven a pedir. El rango elige
   * la serie del ritmo —esa sí se recalcula en memoria— y no las otras dos, que
   * son semanales por definición.
   *
   * Las filas hacen falta aquí porque la composición y las revisitas comparan
   * cada marca con el peldaño de su tune, y esta pantalla no las traía. Se piden
   * en el mismo viaje que las marcas.
   */
  const COMPOSITION_WEEKS = 8;

  const [insightMarks, setInsightMarks] = createSignal<InsightMark[]>([]);
  const [insightEvents, setInsightEvents] = createSignal<InsightEvent[]>([]);
  const [insightRows, setInsightRows] = createSignal<RepertoireRow[]>([]);
  const [insightsLoading, setInsightsLoading] = createSignal(true);
  const [insightsError, setInsightsError] = createSignal<string | null>(null);

  const loadInsights = async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const [insightMarksResult, insightEventsResult, rows] = await Promise.all([
        fetchInsightMarks(),
        fetchInsightEvents(),
        fetchRepertoire(),
      ]);
      setInsightMarks(insightMarksResult);
      setInsightEvents(insightEventsResult);
      setInsightRows(rows);
    } catch {
      setInsightsError('Could not load the statistics.');
    } finally {
      setInsightsLoading(false);
    }
  };

  onMount(() => {
    void loadInsights();
  });

  /** El plan del propio usuario: la línea que el ritmo se mide contra. */
  const dailyTarget = readPrefs(window.localStorage).dailyTarget;

  const pace = createMemo(() => paceSeries(insightMarks(), { nowMs: nowMs(), range: range() }));
  const alive = createMemo(() => aliveInRange(insightMarks(), nowMs(), 14));
  const composition = createMemo(() =>
    compositionByWeek(insightRows(), insightEvents(), COMPOSITION_WEEKS, nowMs())
  );
  const revisitSummary = createMemo(() => revisits(insightMarks(), insightRows()));
  const ladderSince = createMemo(() => ladderHistorySince(insightEvents()));

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

          {/* Panel de estado (#22), después de los días: ritmo, composición y
              revisitas. Tres preguntas distintas de las de la lista —cuánto,
              cómo se reparte y con qué hueco— y las tres con la misma marca. */}
          <Show when={insightsError()}>
            <p class="notice notice-error" role="alert">
              {insightsError()}
            </p>
          </Show>

          <Show when={!insightsError()}>
            <Show
              when={!insightsLoading()}
              fallback={<p class="notice">Loading the statistics…</p>}
            >
              <section class="history-insights" aria-label="Repertoire status">
                <PaceChart
                  points={pace()}
                  range={range()}
                  dailyTarget={dailyTarget}
                  alive={alive()}
                />
                <CompositionChart weeks={composition()} ladderSince={ladderSince()} />
                <RevisitsChart summary={revisitSummary()} />
              </section>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** Un día: su fecha, su recuento y las tunes que se tocaron. */
function HistoryDayBlock(props: { day: HistoryDay; nowMs: number }) {
  // Cada título vuelve a la ficha con su origen: el historial, con su rango.
  const tuneHref = useTuneHref();
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
                <A class="history-title" href={tuneHref(entry.repertoireId)}>
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
