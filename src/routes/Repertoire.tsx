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
  learningSlots,
  shelvedCount,
  statusCounts,
  type BandGroup,
  type RepertoireRow,
} from '../lib/repertoire';
import { readPrefs } from '../lib/practice-storage';
import { createRepertoireStore } from '../lib/repertoire-store';
import { preloadCatalogue } from '../lib/catalogue-db';
import TuneCard from '../components/TuneCard';
import AddTuneAside from '../components/AddTuneAside';
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
  const [addOpen, setAddOpen] = createSignal(false);

  const counts = createMemo(() => statusCounts(store.rows()));
  const backlogTotal = createMemo(() => backlogCount(store.rows()));
  const shelvedTotal = createMemo(() => shelvedCount(store.rows()));
  const slots = createMemo(() =>
    learningSlots(store.rows(), readPrefs(window.localStorage).learningSlots)
  );

  /**
   * Las bandas de la **biblioteca**: `learning` no está —tiene pantalla propia— y
   * el backlog tampoco, porque no es un peldaño. Ver `LIBRARY_BANDS`.
   */
  const groups = createMemo(() => groupIntoBands(store.rows(), store.now(), LIBRARY_BANDS));

  /** Los tunes que ya están en el repertorio, por `origin_ref` (ids de TheSession). */
  const ownedRefs = createMemo(
    () =>
      new Set(
        store
          .rows()
          .filter((row) => row.tune.origin === 'thesession' && row.tune.origin_ref)
          .map((row) => row.tune.origin_ref!)
      )
  );

  onMount(() => {
    void store.load();
    // El artefacto del catálogo se descarga en segundo plano: cuando se abre el
    // cajón del alta, el buscador ya está listo.
    void preloadCatalogue();
  });

  return (
    <div class="repertoire-home">
      <header class="page-head">
        <div>
          <h1>Repertoire</h1>
          <p class="sub">
            <Show when={!store.loading()} fallback="Loading…">
              <b>{tuneCountLabel(store.rows().length)}</b>
              {' · '}
              {/* Cada cifra que no es una banda de esta pantalla es su puerta: el
                  backlog y las aparcadas no se pintan aquí, y `learning` tiene
                  pantalla propia. Si no fueran puertas, los números sobrarían. */}
              <A class="shelved-link" href={listingHref(BACKLOG_SCOPE)}>
                {backlogTotal()} to learn
              </A>
              {' · '}
              <A class="shelved-link" href="/learning">
                {counts().learning} learning
              </A>
              {' · '}
              {counts().shaky} shaky · {counts().playing_along} playing along ·{' '}
              {counts().solo_ready} solo-ready · {counts().mastered} mastered
              <Show when={shelvedTotal() > 0}>
                {' · '}
                <A class="shelved-link" href={listingHref(SHELVED_SCOPE)}>
                  {shelvedTotal()} shelved
                </A>
              </Show>
            </Show>
          </p>
        </div>
        <div class="head-tools">
          {/* La búsqueda vive en /search: cruza todos los peldaños y filtra por
              ritmo. La home no busca — dos buscadores con reglas distintas en la
              misma app es justo lo que hay que evitar. */}
          <A class="search search--door" href="/search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            Search tunes
          </A>
          <button type="button" class="add" onClick={() => setAddOpen(true)}>
            Add a tune
          </button>
        </div>
      </header>

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

      <Show when={addOpen()}>
        <AddTuneAside
          existingRefs={ownedRefs()}
          slots={slots()}
          onAdded={store.reload}
          onClose={() => setAddOpen(false)}
        />
      </Show>
    </div>
  );
}
