import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import {
  BACKLOG_SCOPE,
  LIBRARY_BANDS,
  RUNG_BARS,
  SHELVED_SCOPE,
  backlogCount,
  capForColumns,
  capRows,
  groupIntoBands,
  shelvedCount,
  statusCounts,
  type BandGroup,
  type RepertoireRow,
} from '../lib/repertoire';
import { createRepertoireStore } from '../lib/repertoire-store';
import { preloadCatalogue } from '../lib/catalogue-db';
import {
  overdueDelta,
  overdueHistogram,
  overdueTrend,
  type InsightEvent,
  type InsightMark,
} from '../lib/insights';
import { fetchInsightEvents, fetchInsightMarks } from '../lib/insights-data';
import { aliveInRange, streakFromMarks } from '../lib/insights-view';
import TuneCard from '../components/TuneCard';
import StatStrip from '../components/insights/StatStrip';
import OverdueHistogram from '../components/insights/OverdueHistogram';
import OverdueTrendChart from '../components/insights/OverdueTrendChart';
import LevelShare, { type LevelShareEntry } from '../components/insights/LevelShare';
import './repertoire.css';

/**
 * La home del repertorio: **la biblioteca** —qué puedo tocar esta noche—.
 *
 * Hasta el corte de pantallas esta vista hacía cuatro trabajos a la vez: la
 * escalera de cartas, el banco de trabajo de `learning`, la tabla del listado
 * (con su conmutador) y el alta en línea. Cada uno tiene ahora su sitio:
 *
 *   · `learning` → `/learning`, con su lista, su reloj (el dwell) y su tope.
 *   · el listado de un peldaño → `/level/:band`, que es una tabla de consulta.
 *   · el alta → un cajón lateral (`AddTuneAside`) que no mueve la pantalla.
 *
 * Lo que queda es una sola pregunta, y las reglas que la sostienen no cambian:
 *   · Una sola carta para todas las filas, orden por abandono dentro de cada
 *     banda: nunca tocada primero y después la más fría.
 *   · **Tres filas por banda y nada más**: el tope se mide sobre las columnas
 *     reales de la rejilla, así que la página no crece con el repertorio. Lo que
 *     no cabe no se despliega aquí: se mira en el listado del peldaño, que es la
 *     superficie hecha para muchas filas.
 *   · El backlog y las aparcadas no se pintan: solo sus recuentos, y esos
 *     recuentos son puertas.
 */
function tuneCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tune' : 'tunes'}`;
}

/**
 * El listado de un peldaño es la otra pantalla: la banda enlaza a él y, cuando
 * las cartas se cortan, la puerta aparece también al pie de la rejilla.
 */
function listingHref(status: string): string {
  return `/level/${status}`;
}

/**
 * Una banda de la biblioteca: su cabecera, sus cartas y la puerta al listado.
 *
 * No hay carga progresiva: la home no recorre una banda entera. Lo que no cabe
 * en las tres filas no se despliega — se mira en la lista, que es la superficie
 * que sí está hecha para muchas filas.
 */
function BandView(props: {
  group: BandGroup;
  now: number;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
}) {
  let grid: HTMLDivElement | undefined;

  // Columnas reales de la rejilla: es lo que decide el tope de tres filas.
  const [columns, setColumns] = createSignal(4);

  const measure = () => {
    if (!grid) return;
    const template = window.getComputedStyle(grid).gridTemplateColumns;
    const count = template.split(' ').filter(Boolean).length;
    if (count > 0) setColumns(count);
  };

  onMount(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    // El ancho de la rejilla también cambia sin que cambie la ventana (barra de
    // scroll, cajón del alta); el observador cubre los dos casos.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && grid) {
      observer = new ResizeObserver(() => measure());
      observer.observe(grid);
    }

    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    });
  });

  const cap = createMemo(() => capForColumns(columns()));
  const rows = createMemo(() => capRows(props.group.rows, cap()));
  const total = createMemo(() => props.group.rows.length);

  return (
    <section
      class="band"
      data-band={props.group.band.status}
      aria-labelledby={`band-${props.group.band.status}`}
    >
      <div class="band-head">
        <span class="rungs" aria-hidden="true">
          <For each={RUNG_BARS}>
            {(rung) => <i classList={{ on: rung <= props.group.band.rung }} />}
          </For>
        </span>
        <h2 id={`band-${props.group.band.status}`}>
          <A class="band-link" href={listingHref(props.group.band.status)}>
            {props.group.band.label}
          </A>
        </h2>
        <span class="def">{props.group.band.definition}</span>
        <span class="count">{tuneCountLabel(total())}</span>
      </div>

      <Show
        when={total() > 0}
        fallback={<p class="band-empty">Nothing at this level yet.</p>}
      >
        <div class="grid-4" ref={grid}>
          <For each={rows()}>
            {(row) => <TuneCard row={row} now={props.now} onPractise={props.onPractise} />}
          </For>
        </div>

        <Show when={total() > cap()}>
          <A class="more" href={listingHref(props.group.band.status)}>
            All {total()} as list
          </A>
        </Show>
      </Show>
    </section>
  );
}

export default function Repertoire() {
  const store = createRepertoireStore();

  const counts = createMemo(() => statusCounts(store.rows()));
  const shelvedTotal = createMemo(() => shelvedCount(store.rows()));

  /**
   * El reparto por nivel del donut (#65): los mismos recuentos que la línea de
   * texto que sustituye, y cada fila es la puerta que esa línea tenía. El
   * backlog y las aparcadas no se pintan como bandas en esta pantalla, pero sí
   * cuentan en el donut: es el reparto **del repertorio entero**, y esconder 122
   * tunes en el backlog convertiría el gráfico en un tercio de la verdad.
   */
  const share = createMemo<LevelShareEntry[]>(() => {
    const c = counts();
    return [
      { key: 'to_learn', label: 'To learn', count: c.to_learn, href: listingHref(BACKLOG_SCOPE) },
      { key: 'learning', label: 'Learning', count: c.learning, href: '/learning' },
      { key: 'shaky', label: 'Shaky', count: c.shaky, href: listingHref('shaky') },
      {
        key: 'playing_along',
        label: 'Playing along',
        count: c.playing_along,
        href: listingHref('playing_along'),
      },
      { key: 'solo_ready', label: 'Solo-ready', count: c.solo_ready, href: listingHref('solo_ready') },
      { key: 'mastered', label: 'Mastered', count: c.mastered, href: listingHref('mastered') },
      { key: 'shelved', label: 'Shelved', count: shelvedTotal(), href: listingHref(SHELVED_SCOPE) },
    ];
  });

  /**
   * Las bandas de la **biblioteca**: `learning` no está —tiene pantalla propia— y
   * el backlog tampoco, porque no es un peldaño. Ver `LIBRARY_BANDS`.
   */
  const groups = createMemo(() => groupIntoBands(store.rows(), store.now(), LIBRARY_BANDS));

  /**
   * El panel de estado (#22): sus dos consultas —marcas y eventos de escalera—
   * se piden **una vez al montar**, en paralelo y aparte de la carga del
   * repertorio. No se recargan con cada gesto de la pantalla (marcar, cambiar de
   * peldaño, abrir el cajón): las cifras hablan del día, no del último clic, y
   * un refetch por señal convertiría cada gesto en cuatro peticiones.
   */
  const [insightMarks, setInsightMarks] = createSignal<InsightMark[]>([]);
  const [insightEvents, setInsightEvents] = createSignal<InsightEvent[]>([]);
  const [insightsLoading, setInsightsLoading] = createSignal(true);
  const [insightsError, setInsightsError] = createSignal<string | null>(null);

  const loadInsights = async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const [marks, events] = await Promise.all([fetchInsightMarks(), fetchInsightEvents()]);
      setInsightMarks(marks);
      setInsightEvents(events);
    } catch {
      // Mensaje fijo, no el de PostgREST: el aviso del repertorio ya cuenta lo
      // suyo y aquí lo único que hay que decir es que las cifras no están.
      setInsightsError('Could not load the statistics.');
    } finally {
      setInsightsLoading(false);
    }
  };

  /**
   * Un solo instante para el panel: la cifra de vencidas, el delta y el
   * histograma tienen que hablar del mismo día. Sale del reloj de la vista del
   * store, que se refresca al cargar y al recargar.
   */
  const insightsNow = createMemo(() => store.now());
  const histogram = createMemo(() => overdueHistogram(store.rows(), insightsNow()));
  const overdue = createMemo(() =>
    overdueDelta(store.rows(), insightMarks(), insightEvents(), insightsNow())
  );
  /**
   * La tendencia (#65): ventana de 30 días, recortada por la propia función al
   * primer día con historia de escalera. Se piden 30 y no 90 porque PostgREST
   * corta las marcas en 1 000 y la serie empieza en cualquier caso a finales de
   * octubre: pedir más días no añadiría puntos, añadiría la ilusión de ellos.
   */
  const trend = createMemo(() =>
    overdueTrend(store.rows(), insightMarks(), insightEvents(), insightsNow(), 30)
  );
  const alive = createMemo(() => aliveInRange(insightMarks(), insightsNow(), 14));
  const streak = createMemo(() => streakFromMarks(insightMarks(), insightsNow()));

  onMount(() => {
    void store.load();
    void loadInsights();
    // El artefacto del catálogo se descarga en segundo plano: cuando se abre el
    // cajón del alta, el buscador ya está listo.
    void preloadCatalogue();
  });

  return (
    <div class="repertoire-home">
      {/* La cabecera ya no lleva herramientas (#65): la búsqueda está en el menú
          principal y el alta también, así que repetirlas aquí era duplicarlas —
          dos puertas al mismo sitio—. Lo que había en la línea de recuentos vive
          ahora en el donut, donde el peso de cada nivel se ve. */}
      <header class="page-head">
        <h1>Repertoire</h1>
      </header>

      {/* Panel de estado (#22/#65): el reparto por nivel, las cuatro cifras y la
          pareja histograma + tendencia, en papel y justo bajo la cabecera. Las
          bandas de debajo no se mueven ni se reordenan: el panel es un resumen,
          no otra pantalla. */}
      <section class="insights" aria-label="Repertoire status">
        <Show when={insightsError()}>
          <p class="notice notice-error" role="alert">
            {insightsError()}
          </p>
        </Show>

        <Show when={!insightsError()}>
          <Show
            when={!insightsLoading() && !store.loading()}
            fallback={<p class="notice">Loading the figures…</p>}
          >
            <LevelShare entries={share()} total={store.rows().length} />
            <StatStrip histogram={histogram()} alive={alive()} streak={streak()} />
            <div class="insights-charts">
              <OverdueHistogram histogram={histogram()} delta={overdue()} nowMs={insightsNow()} />
              <OverdueTrendChart trend={trend()} />
            </div>
          </Show>
        </Show>
      </section>

      <Show when={store.error()}>
        <p class="notice notice-error" role="alert">
          {store.error()}
        </p>
      </Show>

      <div class="sortbar">
        <span class="lbl">Within each level</span>
        <span>Staleness — longest untouched first</span>
        <span class="spacer" />
        <span class="heat">
          <i />
          going cold
        </span>
      </div>

      <Show
        when={!store.loading()}
        fallback={<p class="notice">Loading your repertoire…</p>}
      >
        <Show
          when={store.rows().length > 0}
          fallback={
            <div class="empty">
              <p>Your repertoire is empty.</p>
              <p>Add the first tune you want to keep track of, and give it a level.</p>
            </div>
          }
        >
          <For each={groups()}>
            {(group) => <BandView group={group} now={store.now()} onPractise={store.practise} />}
          </For>
        </Show>
      </Show>
    </div>
  );
}
