import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import {
  BANDS,
  SHELVED_SCOPE,
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
  parseScope,
  parseViewMode,
  removeFromRepertoire,
  shelvedCount,
  sortRepertoire,
  statusCounts,
  VIEW_MODE_KEY,
  type BandGroup,
  type RepertoireRow,
  type RepertoireScope,
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
import ImportFromSession from '../components/ImportFromSession';
import './repertoire.css';

/**
 * Home del repertorio (#29).
 *
 * La pantalla ya no es una lista ordenada sino cuatro bandas en orden de
 * escalera (to_learn → learning → playing_along → solo_ready), cada una con su
 * definición escrita y su recuento, y **una sola carta** para todas las filas.
 *
 * Cuatro reglas mandan sobre el resto:
 *   · Dentro de cada banda, orden por staleness: nunca tocada primero, después
 *     días descendentes. El orden es del modelo puro (`groupIntoBands`), no del
 *     JSX ni de la base.
 *   · La home enseña **dos filas por banda y nada más** (8 cartas con cuatro
 *     columnas). El tope se mide sobre las columnas reales de la rejilla y se
 *     recalcula al cambiar el ancho; no es un número fijo. Así el máximo de la
 *     pantalla son 32 cartas y la página no crece con el repertorio.
 *   · El listado completo de un peldaño **es una lista**, no una rejilla: el
 *     título de la banda y «See all N as list» abren esa sola banda en la tabla,
 *     con su orden elegido a mano. De ahí se vuelve con «Back to all».
 *   · Las aparcadas **no se ven en la home**: solo su recuento, en la cabecera,
 *     que es la puerta a su listado. Aparcar no cambia el peldaño, así que no
 *     son una quinta banda.
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

/**
 * La banda de la home: dos filas de cartas, su recuento y la puerta al listado.
 *
 * No hay carga progresiva: la home no recorre una banda entera. Lo que no cabe
 * en las dos filas no se despliega en la rejilla — se mira en la lista, que es
 * la superficie que sí está hecha para muchas filas.
 */
function BandView(props: {
  group: BandGroup;
  now: number;
  /** Con texto en el buscador se ignoran los topes (§2.5). */
  searching: boolean;
  /** Esta banda es la única en pantalla (?band=…). */
  scoped: boolean;
  /** Aísla esta banda en la rejilla (solo queda ella en pantalla). */
  onShowOnly: () => void;
  /** Abre el listado completo de esta banda, en la tabla. */
  onSeeList: () => void;
  onPractise: (row: RepertoireRow) => void | Promise<void>;
}) {
  let grid: HTMLDivElement | undefined;

  // Columnas reales de la rejilla: es lo que decide el tope de dos filas.
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

  const cap = createMemo(() => capForColumns(columns()));
  const limit = createMemo(() => (props.searching ? Number.POSITIVE_INFINITY : cap()));
  const rows = createMemo(() => capRows(props.group.rows, limit()));
  const total = createMemo(() => props.group.rows.length);
  /** Hay más de las que caben, o la banda está aislada y se quiere entera. */
  const offersList = createMemo(() => props.searching === false && (props.scoped || total() > cap()));

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
            when={!props.scoped}
            fallback={props.group.band.label}
          >
            <button
              type="button"
              aria-label={`Show only ${props.group.band.label}`}
              onClick={props.onShowOnly}
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
        <div class="grid-4" ref={grid}>
          <For each={rows()}>
            {(row) => (
              <TuneCard
                row={row}
                now={props.now}
                onPractise={props.onPractise}
              />
            )}
          </For>
        </div>

        {/* El listado completo de un peldaño es una lista, no una rejilla: no
            hay «desplegar» que valga. Con texto en el buscador no se ofrece,
            porque el buscador ya trae lo que casa. */}
        <Show when={offersList()}>
          <button type="button" class="more" onClick={props.onSeeList}>
            See all {total()} as list
          </button>
        </Show>
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
  // El import de The Session (#32) se abre en el mismo sitio que el catálogo:
  // un panel en línea, no un modal. Los dos pueden estar abiertos a la vez.
  const [showImport, setShowImport] = createSignal(false);
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

  // Lo que se está mirando vive en la URL (§2.7): recargar mantiene la vista.
  // `?band=` acepta los cuatro peldaños y `shelved`, que es el cajón.
  const [params, setParams] = useSearchParams<{ band?: string }>();
  const scope = createMemo<RepertoireScope | null>(() => parseScope(params.band));
  /** El ámbito es un peldaño (no el cajón): lo que aísla una banda de la home. */
  const scopedBand = createMemo<TuneStatus | null>(() => {
    const current = scope();
    return current !== null && current !== SHELVED_SCOPE ? current : null;
  });
  /**
   * El cajón no se pinta en rejilla nunca: sus tunes se miran en lista, que es
   * la única superficie de la app hecha para muchas filas. Así no hay un estado
   * muerto en el que el conmutador Table/Cards no signifique nada.
   */
  const effectiveMode = createMemo<ViewMode>(() =>
    scope() === SHELVED_SCOPE ? 'table' : viewMode()
  );

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    rememberViewMode(mode);
  };

  const tokens = createMemo(() => tokenizeQuery(query()));
  const counts = createMemo(() => statusCounts(rows()));
  /** Las del cajón, para que la cabecera sume: bandas + aparcadas = repertorio. */
  const shelvedTotal = createMemo(() => shelvedCount(rows()));

  /** Las cuatro bandas, cada una ordenada por staleness. */
  const groups = createMemo(() => groupIntoBands(rows(), now()));

  /**
   * Lo que se pinta. Sin texto: las cuatro bandas, vacías incluidas, porque la
   * pantalla es la escalera. Con texto: las bandas con aciertos, sin vacías. Y
   * con una banda aislada, esa sola —el buscador sigue vivo dentro de ella—.
   */
  const visibleGroups = createMemo(() => {
    const term = search();
    const open = scopedBand();
    if (open) {
      const group = groups().find((candidate) => candidate.band.status === open);
      if (!group) return [];
      if (term.trim().length === 0) return [group];
      return [{ band: group.band, rows: group.rows.filter((row) => matchesQuery(row, term)) }];
    }
    return filterBands(groups(), term);
  });

  /**
   * La tabla consume las filas de su ámbito y el orden elegido a mano. Un
   * peldaño excluye las aparcadas —aparcar no cambia el peldaño, pero las
   * aparcadas fuera de rotación—, así que la lista de una banda cuadra con su
   * recuento; el cajón hace lo contrario y solo trae las aparcadas.
   */
  const tableRows = createMemo(() => {
    const term = search().trim();
    const current = scope();
    let pool = rows();
    if (current === SHELVED_SCOPE) pool = pool.filter((row) => row.shelved);
    else if (current !== null) pool = pool.filter((row) => row.status === current && !row.shelved);
    if (term.length > 0) pool = pool.filter((row) => matchesQuery(row, term));
    return sortRepertoire(pool, sortKey());
  });

  /** Título del ámbito para la barra: el peldaño o «Shelved». */
  const scopeLabel = createMemo(() => {
    const current = scope();
    if (current === null) return null;
    return current === SHELVED_SCOPE ? 'Shelved' : bandFor(current).label;
  });

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

  /** Aísla una banda en la rejilla: solo queda ella en pantalla. */
  const showOnly = (status: TuneStatus) => setParams({ band: status });
  /** Abre el listado completo: la banda (o el cajón) en la tabla, sin cartas. */
  const seeList = (target: RepertoireScope) => {
    setParams({ band: target });
    chooseView('table');
  };
  /** La puerta de las aparcadas: su recuento en la cabecera lleva a su listado. */
  const seeShelved = () => seeList(SHELVED_SCOPE);
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
              {/* Las aparcadas no se pintan en la home, solo su recuento —y ese
                  recuento es la puerta a su listado, que si no no habría dónde
                  mirarlas—. Se nombran para que el total cuadre: bandas más
                  aparcadas son el repertorio entero. */}
              <Show when={shelvedTotal() > 0}>
                {' · '}
                <button type="button" class="shelved-link" onClick={seeShelved}>
                  {shelvedTotal()} shelved
                </button>
              </Show>
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
          {/* El conmutador no se ofrece mirando el cajón: sus tunes no se pintan
              en rejilla, así que «Cards» no tendría efecto. */}
          <Show when={scope() !== SHELVED_SCOPE}>
            <div class="viewswitch" role="group" aria-label="Repertoire view">
              <button
                type="button"
                aria-pressed={effectiveMode() === 'table'}
                onClick={() => chooseView('table')}
              >
                Table
              </button>
              <button
                type="button"
                aria-pressed={effectiveMode() === 'grid'}
                onClick={() => chooseView('grid')}
              >
                Cards
              </button>
            </div>
          </Show>
          <button type="button" class="add" onClick={() => setShowCatalogue((open) => !open)}>
            {showCatalogue() ? 'Close catalogue' : 'Add a tune'}
          </button>
          <button
            type="button"
            class="add add--quiet"
            aria-expanded={showImport()}
            onClick={() => setShowImport((open) => !open)}
          >
            {showImport() ? 'Close import' : 'Import from The Session'}
          </button>
        </div>
      </header>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
      </Show>

      {/* Import del tunebook (#32): mismo sitio y misma forma que el catálogo,
          porque es la otra puerta de entrada al repertorio. */}
      <Show when={showImport()}>
        <ImportFromSession
          existingRefs={ownedRefs()}
          onImported={() => void reload()}
          onClose={() => setShowImport(false)}
        />
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

      {/* El buscador de la home sigue en pantalla con una banda aislada (§2.7);
          el que se oculta es el resto de bandas, no la herramienta. */}
      <Show when={effectiveMode() === 'grid'}>
        <div class="sortbar">
          <Show
            when={scopeLabel()}
            fallback={
              <>
                <span class="lbl">Within each level</span>
                <span>Staleness — longest untouched first</span>
              </>
            }
          >
            <span class="lbl">Showing</span>
            <span>{scopeLabel()}</span>
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

      <Show when={effectiveMode() === 'table'}>
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
          {/* Una lista acotada dice de qué es; sin ámbito, es todo el repertorio. */}
          <Show when={scopeLabel()}>
            <span class="lbl">Showing</span>
            <span>{scopeLabel()}</span>
            <button type="button" class="back-to-all" onClick={backToAll}>
              Back to all
            </button>
          </Show>
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
            when={effectiveMode() === 'grid'}
            fallback={
              <RepertoireTable rows={tableRows()} busyId={busyId()} onRemove={remove} />
            }
          >
            <Show
              when={visibleGroups().length > 0}
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
                    scoped={scopedBand() === group.band.status}
                    onShowOnly={() => showOnly(group.band.status)}
                    onSeeList={() => seeList(group.band.status)}
                    onPractise={practise}
                  />
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
