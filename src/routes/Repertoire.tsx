import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import {
  BANDS,
  SORT_LABELS,
  STATUS_LABELS,
  addCatalogueTune,
  bandFor,
  capForColumns,
  capRows,
  displayKey,
  displayRhythm,
  displayTitle,
  fetchRepertoire,
  filterBands,
  groupIntoBands,
  matchesQuery,
  parseViewMode,
  removeFromRepertoire,
  sortRepertoire,
  statusCounts,
  VIEW_MODE_KEY,
  visibleShelved,
  type BandGroup,
  type RepertoireRow,
  type SortKey,
  type TuneStatus,
  type ViewMode,
} from '../lib/repertoire';
import {
  aliasExcerpt,
  matchedViaAlias,
  tokenizeQuery,
  type CatalogueEntry,
} from '../lib/catalogue';
import { preloadCatalogue, searchCatalogue, getCatalogueStats } from '../lib/catalogue-db';
import { normalizeTitle } from '../lib/format';
import { logPractice } from '../lib/practice';
import TuneCard from '../components/TuneCard';
import './repertoire.css';

/**
 * Home del repertorio (#29).
 *
 * La pantalla ya no es una lista ordenada sino cuatro bandas en orden de
 * escalera (to_learn → learning → playing_along → solo_ready), cada una con su
 * definición escrita y su recuento, y dos densidades: carta grande en las bandas
 * de trabajo (ahí se mira la calidad de cada tune) y miniatura en las de
 * biblioteca (ahí hay cien y no se vigilan una a una).
 *
 * Tres reglas mandan sobre el resto:
 *   · Dentro de cada banda, orden por staleness: nunca tocada primero, después
 *     días descendentes. El orden es del modelo puro (`groupIntoBands`), no del
 *     JSX ni de la base.
 *   · Cada banda densa enseña dos filas y ofrece «Show all N». El tope se mide
 *     sobre las columnas reales de la rejilla y se recalcula al cambiar el
 *     ancho; no es un número fijo.
 *   · «Show all» no despliega dentro de la página: deja esa sola banda en
 *     pantalla, la refleja en la URL (`?band=…`) y carga las cartas en tandas de
 *     una fila al hacer scroll. «Back to all» vuelve a la vista completa.
 *
 * La vista de tabla se conserva: mismas columnas, mismo orden elegido a mano,
 * misma baja. Solo cambia el papel.
 */

/**
 * La preferencia de vista se lee al montar y se escribe al cambiar. Si el
 * navegador la bloquea (modo privado) se degrada al grid por defecto, que es la
 * vista principal del repertorio.
 */
function loadViewMode(): ViewMode {
  try {
    return parseViewMode(sessionStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return 'grid';
  }
}

function rememberViewMode(mode: ViewMode): void {
  try {
    sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* sin almacenamiento disponible: la preferencia solo vive en memoria */
  }
}

/** «1 tune» / «12 tunes», con el número ya formateado por quien llama. */
function tuneCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tune' : 'tunes'}`;
}

/** La banda, con su densidad, su tope y su carga progresiva. */
function BandView(props: {
  group: BandGroup;
  now: number;
  /** Con texto en el buscador se ignoran los topes (§2.5). */
  searching: boolean;
  /** Esta banda es la única en pantalla (?band=…), con carga al scroll. */
  expanded: boolean;
  onShowAll: () => void;
  onBackToAll: () => void;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
}) {
  let grid: HTMLDivElement | undefined;

  // Columnas reales de la rejilla: es lo que decide el tope de dos filas.
  const [columns, setColumns] = createSignal(4);
  // Cuántas cartas se han cargado de la banda abierta (tandas de una fila).
  const [shown, setShown] = createSignal(0);
  let sentinel: HTMLDivElement | undefined;

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
    // scroll, panel del catálogo); el observador cubre los dos casos.
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

  /** Al abrir la banda se empieza por una fila; el scroll añade más. */
  createEffect(() => {
    if (props.expanded) setShown(columns());
  });

  const cap = createMemo(() => capForColumns(columns()));
  const limit = createMemo(() => {
    if (props.searching) return Number.POSITIVE_INFINITY;
    if (props.expanded) return shown();
    return cap();
  });
  const rows = createMemo(() => capRows(props.group.rows, limit()));
  const total = createMemo(() => props.group.rows.length);

  /**
   * Carga progresiva al hacer scroll: el centinela del final de la rejilla pide
   * una fila más cuando entra en el viewport. Sin `IntersectionObserver` (o si
   * no hay nada más que cargar) no se observa nada; sin la API se enseña todo,
   * que es el degradado honesto.
   */
  createEffect(() => {
    if (!props.expanded || shown() >= total()) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(total());
      return;
    }
    const step = Math.max(1, columns());
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((current) => Math.min(total(), current + step));
        }
      },
      { rootMargin: '0px' }
    );
    if (sentinel) observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  const gridClass = () => (props.group.band.density === 'card' ? 'grid-4' : 'grid-tiles');

  return (
    <section class="band" data-band={props.group.band.status} aria-labelledby={`band-${props.group.band.status}`}>
      <div class="band-head">
        <span class="rungs" aria-hidden="true">
          <For each={[1, 2, 3, 4]}>
            {(rung) => <i classList={{ on: rung <= props.group.band.rung }} />}
          </For>
        </span>
        {/*
          Atajo al filtro por peldaño (#11): el filtro ya existe por construcción
          (las bandas son los peldaños) y esto solo lo alcanza con el teclado y
          con un clic. Una banda ya aislada no vuelve a ofrecer el atajo.
        */}
        <h2 id={`band-${props.group.band.status}`}>
          <Show
            when={!props.expanded}
            fallback={props.group.band.label}
          >
            <button
              type="button"
              aria-label={`Show only ${props.group.band.label}`}
              onClick={props.onShowAll}
            >
              {props.group.band.label}
            </button>
          </Show>
        </h2>
        <span class="def">{props.group.band.definition}</span>
        <span class="count">{tuneCountLabel(total())}</span>
      </div>

      <Show
        when={total() > 0}
        fallback={<p class="band-empty">Nothing at this level yet.</p>}
      >
        <div class={gridClass()} ref={grid}>
          <For each={rows()}>
            {(row) => (
              <TuneCard
                row={row}
                now={props.now}
                density={props.group.band.density}
                onPractise={props.onPractise}
              />
            )}
          </For>
        </div>

        {/* Con texto en el buscador no hay tope que ofrecer. */}
        <Show when={!props.searching && !props.expanded && total() > cap()}>
          <button type="button" class="more" onClick={props.onShowAll}>
            Show all {total()}
          </button>
        </Show>

        <Show when={props.expanded}>
          <Show when={shown() < total()}>
            <div class="band-sentinel" ref={sentinel} aria-hidden="true" />
          </Show>
          <button type="button" class="more" onClick={props.onBackToAll}>
            Back to all
          </button>
        </Show>
      </Show>
    </section>
  );
}

/**
 * El cajón de las aparcadas (#11), al final de la home.
 *
 * No es una quinta banda: no agrupa, no tiene tope y no carga al scroll. Es un
 * cajón que se abre cuando se busca algo concreto, y por eso arranca cerrado y
 * recuerda su estado solo en esta visita (un `signal` local, sin almacenamiento:
 * la pantalla se abre en las cuatro bandas, que es lo que se mira a diario).
 */
function ShelvedShelf(props: {
  rows: RepertoireRow[];
  now: number;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <section class="band band--shelved" aria-labelledby="band-shelved">
      <div class="band-head">
        <h2 id="band-shelved">Shelved</h2>
        <span class="count">· {tuneCountLabel(props.rows.length)}</span>
        <button
          type="button"
          class="more toggle"
          aria-expanded={open()}
          onClick={() => setOpen((current) => !current)}
        >
          {open() ? 'Hide' : 'Show'}
        </button>
      </div>

      <Show when={open()}>
        <div class="grid-tiles" id="shelved-grid">
          <For each={props.rows}>
            {(row) => (
              <TuneCard row={row} now={props.now} density="tile" onPractise={props.onPractise} />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

/** La tabla clásica (#7): mismas columnas y misma baja, sobre papel. */
function RepertoireTable(props: {
  rows: RepertoireRow[];
  busyId: string | number | null;
  onRemove: (row: RepertoireRow) => void;
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tune</th>
            <th>Rhythm</th>
            <th>Key</th>
            <th>Level</th>
            <th>Added</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <td>
                  <A href={`/repertoire/${row.id}`} title={displayTitle(row)}>
                    {displayTitle(row)}
                  </A>
                  <p class="dim">
                    {row.tune.origin}
                    {row.tune.origin_ref ? ` #${row.tune.origin_ref}` : ''}
                  </p>
                </td>
                <td>{displayRhythm(row)}</td>
                <td>{displayKey(row)}</td>
                <td>
                  <span class="pill">{STATUS_LABELS[row.status]}</span>
                  <Show when={row.shelved}>
                    {' '}
                    <span class="dim">shelved</span>
                  </Show>
                </td>
                <td class="dim">{new Date(row.added_at).toLocaleDateString()}</td>
                <td style={{ 'text-align': 'right' }}>
                  <button
                    type="button"
                    class="remove"
                    disabled={props.busyId === row.id}
                    onClick={() => props.onRemove(row)}
                  >
                    {props.busyId === row.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export default function Repertoire() {
  // El instante de la vista: el tag de todas las cartas habla del mismo «hoy».
  // Se refresca al recargar (tras apuntar un ensayo) para que «today» sea hoy.
  const [now, setNow] = createSignal(Date.now());

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | number | null>(null);
  const [showCatalogue, setShowCatalogue] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<CatalogueEntry[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchMs, setSearchMs] = createSignal<number | null>(null);
  const [catalogueError, setCatalogueError] = createSignal<string | null>(null);
  const [catalogueReady, setCatalogueReady] = createSignal(false);
  const [tuneCount, setTuneCount] = createSignal<number | null>(null);

  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  const [sortKey, setSortKey] = createSignal<SortKey>('urgency');

  // La banda abierta vive en la URL (§2.7): recargar mantiene la vista.
  const [params, setParams] = useSearchParams<{ band?: string }>();
  const activeBand = createMemo<TuneStatus | null>(() => {
    const raw = params.band;
    return typeof raw === 'string' && BANDS.some((band) => band.status === raw)
      ? (raw as TuneStatus)
      : null;
  });

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    rememberViewMode(mode);
  };

  const tokens = createMemo(() => tokenizeQuery(query()));
  const counts = createMemo(() => statusCounts(rows()));

  /** Las cuatro bandas, cada una ordenada por staleness. */
  const groups = createMemo(() => groupIntoBands(rows(), now()));

  /**
   * Lo que se pinta. Sin texto: las cuatro bandas, vacías incluidas, porque la
   * pantalla es la escalera. Con texto: las bandas con aciertos, sin vacías. Y
   * con una banda abierta, esa sola —el buscador sigue vivo dentro de ella—.
   */
  const visibleGroups = createMemo(() => {
    const term = search();
    const open = activeBand();
    if (open) {
      const group = groups().find((candidate) => candidate.band.status === open);
      if (!group) return [];
      if (term.trim().length === 0) return [group];
      return [{ band: group.band, rows: group.rows.filter((row) => matchesQuery(row, term)) }];
    }
    return filterBands(groups(), term);
  });

  /** La tabla consume las filas filtradas y el orden elegido a mano. */
  const tableRows = createMemo(() => {
    const term = search().trim();
    const filtered = term.length === 0 ? rows() : rows().filter((row) => matchesQuery(row, term));
    return sortRepertoire(filtered, sortKey());
  });

  /**
   * Las aparcadas del cajón del final (#11): ordenadas por staleness y
   * respetando el buscador, igual que las bandas. Con una banda aislada no se
   * pintan —esa vista es una sola banda, no la pantalla entera—.
   */
  const shelvedRows = createMemo(() => visibleShelved(rows(), search(), now()));
  const showShelved = createMemo(() => activeBand() === null && shelvedRows().length > 0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Recarga silenciosa tras apuntar un ensayo: no vuelve a poner `loading` para
   * que la rejilla no parpadee con el menú recién cerrado.
   */
  const reload = async () => {
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  onMount(() => {
    void load();
    // Descarga del artefacto en segundo plano: al abrir el buscador ya está.
    void preloadCatalogue().then(
      async () => {
        setCatalogueReady(true);
        try {
          setTuneCount((await getCatalogueStats()).tunes);
        } catch {
          /* el recuento es informativo: si falla, el buscador sigue */
        }
      },
      (cause) => {
        setCatalogueError(cause instanceof Error ? cause.message : String(cause));
        setCatalogueReady(true);
      }
    );
  });

  createEffect(() => {
    const term = query();
    if (term.trim().length === 0) {
      setResults([]);
      setSearchMs(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const started = performance.now();

    void searchCatalogue(term)
      .then((found) => {
        if (cancelled) return;
        setResults(found);
        setSearchMs(performance.now() - started);
        setCatalogueError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setResults([]);
        setCatalogueError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  /**
   * Los tunes que ya están en el repertorio se reconocen por `origin_ref`: el
   * catálogo solo conoce el id de TheSession, no el uuid de `pr_tunes`.
   */
  const ownedRefs = createMemo(
    () =>
      new Set(
        rows()
          .filter((row) => row.tune.origin === 'thesession' && row.tune.origin_ref)
          .map((row) => row.tune.origin_ref!)
      )
  );

  const add = async (entry: CatalogueEntry) => {
    setBusyId(entry.tuneId);
    setError(null);
    try {
      await addCatalogueTune({
        tuneId: entry.tuneId,
        name: entry.name,
        rhythm: entry.type,
        meter: entry.meter,
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: RepertoireRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await removeFromRepertoire(row.id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * «Practise» del menú: apunta el ensayo de un clic, sin puntuarlo. La calidad
   * es opcional por diseño (#10) y se puntúa en el detalle; obligar a pasar por
   * un formulario para apuntar que has tocado una tune mataría el gesto.
   */
  const practise = async (row: RepertoireRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await logPractice(row.id, { quality: null, comment: null });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const showAll = (status: TuneStatus) => setParams({ band: status });
  const backToAll = () => setParams({ band: undefined });

  const searchTerm = () => search().trim().length > 0;

  return (
    <div class="repertoire-home">
      <header class="page-head">
        <div>
          <h1>Repertoire</h1>
          <p class="sub">
            <Show when={!loading()} fallback="Loading…">
              <b>{tuneCountLabel(rows().length)}</b>
              {' · '}
              {counts().to_learn} to learn · {counts().learning} learning ·{' '}
              {counts().playing_along} playing along · {counts().solo_ready} solo-ready
            </Show>
          </p>
        </div>
        <div class="head-tools">
          <label class="search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder={`Search ${rows().length} tunes`}
              aria-label="Search tunes"
              autocomplete="off"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <div class="viewswitch" role="group" aria-label="Repertoire view">
            <button
              type="button"
              aria-pressed={viewMode() === 'table'}
              onClick={() => chooseView('table')}
            >
              Table
            </button>
            <button
              type="button"
              aria-pressed={viewMode() === 'grid'}
              onClick={() => chooseView('grid')}
            >
              Cards
            </button>
          </div>
          <button type="button" class="add" onClick={() => setShowCatalogue((open) => !open)}>
            {showCatalogue() ? 'Close catalogue' : 'Add a tune'}
          </button>
        </div>
      </header>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={showCatalogue()}>
        <section class="catalogue">
          <label for="catalogue-search">Search the tune catalogue</label>
          <input
            id="catalogue-search"
            type="search"
            autocomplete="off"
            placeholder="Name or any alternative title — e.g. butterfly, red admiral…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <p class="hint">
            <Show
              when={catalogueError()}
              fallback={
                <Show
                  when={searchMs() !== null}
                  fallback={
                    tuneCount() === null
                      ? 'Searches run on this device — no network per keystroke.'
                      : `${tuneCount()!.toLocaleString()} tunes from a local database — no network per keystroke.`
                  }
                >
                  {results().length} {results().length === 1 ? 'match' : 'matches'} ·{' '}
                  {(searchMs() ?? 0).toFixed(1)} ms · searched on this device
                </Show>
              }
            >
              <span>{catalogueError()}</span>
            </Show>
          </p>

          <Show when={!catalogueReady()}>
            <p class="hint">Loading the catalogue (4.5 MB, downloaded once)…</p>
          </Show>

          <Show when={catalogueReady() && query().trim().length > 0}>
            <Show
              when={results().length > 0}
              fallback={
                <p class="hint">{searching() ? 'Searching…' : 'No tune matches that search.'}</p>
              }
            >
              <ul>
                <For each={results()}>
                  {(entry) => {
                    const alias = aliasExcerpt(entry, tokens());
                    const viaAlias = matchedViaAlias(entry, tokens());
                    const owned = () => ownedRefs().has(String(entry.tuneId));
                    return (
                      <li>
                        <div>
                          <p class="cat-title">{normalizeTitle(entry.name)}</p>
                          <p class="cat-meta">
                            {entry.type ?? '—'}
                            {entry.meter ? ` · ${entry.meter}` : ''}
                            <span> · thesession #{entry.tuneId}</span>
                          </p>
                          <Show when={viaAlias && alias}>
                            <p class="cat-meta">
                              Also known as <b>{alias}</b>
                            </p>
                          </Show>
                        </div>
                        <button
                          type="button"
                          class="cat-add"
                          disabled={busyId() === entry.tuneId || owned()}
                          onClick={() => void add(entry)}
                        >
                          {owned()
                            ? 'In repertoire'
                            : busyId() === entry.tuneId
                              ? 'Adding…'
                              : 'Add'}
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>

          <Show when={catalogueReady() && query().trim().length === 0}>
            <p class="hint">
              Type a name — or an alternative one. The search looks at titles and at every
              alternative title in the catalogue.
            </p>
          </Show>
        </section>
      </Show>

      {/* El buscador de la home sigue en pantalla con una banda abierta (§2.7);
          el que se oculta es el resto de bandas, no la herramienta. */}
      <Show when={viewMode() === 'grid'}>
        <div class="sortbar">
          <Show
            when={activeBand()}
            fallback={
              <>
                <span class="lbl">Within each level</span>
                <span>Staleness — longest untouched first</span>
              </>
            }
          >
              <span class="lbl">Showing</span>
              <span>{bandFor(activeBand()!).label}</span>
              <button type="button" class="back-to-all" onClick={backToAll}>
                Back to all
              </button>
          </Show>
          <span class="spacer" />
          <span class="heat">
            <i />
            going cold
          </span>
        </div>
      </Show>

      <Show when={viewMode() === 'table'}>
        <div class="sortbar">
          <span class="lbl">Sort by</span>
          <select
            aria-label="Sort by"
            value={sortKey()}
            onChange={(event) => setSortKey(event.currentTarget.value as SortKey)}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option value={key}>{SORT_LABELS[key]}</option>
            ))}
          </select>
          <span class="spacer" />
        </div>
      </Show>

      <Show
        when={!loading()}
        fallback={<p class="notice">Loading your repertoire…</p>}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              <p>Your repertoire is empty.</p>
              <p>Open the catalogue and add the first tune you want to keep track of.</p>
            </div>
          }
        >
          <Show
            when={viewMode() === 'grid'}
            fallback={
              <RepertoireTable rows={tableRows()} busyId={busyId()} onRemove={remove} />
            }
          >
            <Show
              when={visibleGroups().length > 0 || showShelved()}
              fallback={
                <p class="notice">
                  No tune in your repertoire matches “{search().trim()}”.
                </p>
              }
            >
              <For each={visibleGroups()}>
                {(group) => (
                  <BandView
                    group={group}
                    now={now()}
                    searching={searchTerm()}
                    expanded={activeBand() === group.band.status}
                    onShowAll={() => showAll(group.band.status)}
                    onBackToAll={backToAll}
                    onPractise={practise}
                  />
                )}
              </For>

              {/* El cajón va después de las cuatro bandas, y solo en la vista
                  completa: con una banda aislada la pantalla es esa banda. */}
              <Show when={showShelved()}>
                <ShelvedShelf rows={shelvedRows()} now={now()} onPractise={practise} />
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
