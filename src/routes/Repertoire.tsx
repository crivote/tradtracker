import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import {
  SORT_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  addCatalogueTune,
  displayKey,
  displayRhythm,
  displayTitle,
  fetchRepertoire,
  parseViewMode,
  placeholderInitials,
  practiceRecency,
  removeFromRepertoire,
  sortRepertoire,
  VIEW_MODE_KEY,
  type RepertoireRow,
  type SortKey,
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
import { focalPosition } from '../lib/image-sources';
import PracticeLog from '../components/PracticeLog';

/**
 * Vista de la colección.
 *
 * El alta busca en el catálogo completo (issue #4): `public/thesession.db`, un
 * SQLite de 22.775 tunes que se descarga una vez y se consulta en el navegador.
 * Ya no se limita a las tunes sembradas en `pr_tunes`. Al elegir un resultado se
 * resuelve su fila compartida por `(origin='thesession', origin_ref=tune_id)` y
 * se añade al repertorio del usuario.
 *
 * Los títulos alternativos cuentan: cada token se busca en el nombre y en la
 * columna `aliases`, y cuando el acierto viene de un alias se enseña el alias,
 * para que «Butterfly, The» al buscar «red admiral» no parezca un error.
 *
 * El orden (issue #7) no es cosa de la base: `fetchRepertoire` sigue trayendo
 * por `added_at` y `sortRepertoire` — puro y probado en `repertoire-model` —
 * reordena en el navegador con el criterio elegido, y ambas vistas (tabla y
 * tarjetas) consumen las mismas filas ordenadas. La preferencia tabla/grid
 * vive en `sessionStorage`: sobrevive a recargas de esta pestaña sin tocar la
 * base de datos.
 *
 * Corte 2 de la issue: la card enseña los días desde el último ensayo (no la
 * fecha), un cuadro con las iniciales como placeholder de la imagen
 * mnemotécnica y el título enlaza a `/repertoire/:id`, el detalle del tune.
 * `now` se toma una sola vez aquí, al montar, y baja como prop: la función pura
 * `practiceRecency` nunca lee el reloj.
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

/** La tabla clásica, intacta, pero alimentada por las filas ya ordenadas. */
function RepertoireTable(props: {
  rows: RepertoireRow[];
  busyId: string | number | null;
  onRemove: (row: RepertoireRow) => void;
}) {
  return (
    <div class="overflow-x-auto rounded-lg border border-gray-700">
      <table class="w-full text-left text-sm">
        <thead class="bg-gray-800 text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th class="px-4 py-3 font-medium">Tune</th>
            <th class="px-4 py-3 font-medium">Rhythm</th>
            <th class="px-4 py-3 font-medium">Key</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium">Added</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-700 bg-gray-900">
          <For each={props.rows}>
            {(row) => (
              <tr class="hover:bg-gray-800/60">
                <td class="px-4 py-3">
                  <A
                    href={`/repertoire/${row.id}`}
                    class="text-gray-100 hover:text-amber-300 hover:underline"
                    title={displayTitle(row)}
                  >
                    {displayTitle(row)}
                  </A>
                  <p class="text-xs text-gray-500">
                    {row.tune.origin}
                    {row.tune.origin_ref ? ` #${row.tune.origin_ref}` : ''}
                  </p>
                </td>
                <td class="px-4 py-3 text-gray-300">{displayRhythm(row)}</td>
                <td class="px-4 py-3 text-gray-300">{displayKey(row)}</td>
                <td class="px-4 py-3">
                  <span
                    class={`inline-block rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[row.status]}`}
                  >
                    {STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-400">
                  {new Date(row.added_at).toLocaleDateString()}
                </td>
                <td class="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={props.busyId === row.id}
                    class="text-xs text-gray-500 hover:text-red-300 disabled:opacity-60"
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

/**
 * La vista de tarjetas (#7): los mismos datos, en formato de grid. El cuadro de
 * iniciales es el placeholder de la imagen mnemotécnica (la subida real llega en
 * F10) y el título es el enlace al detalle: la tarjeta entera no puede serlo,
 * porque lleva dentro un `<button>` de baja y un `<a>` con un botón dentro no es
 * HTML válido.
 */
function GridView(props: {
  rows: RepertoireRow[];
  now: number;
  busyId: string | number | null;
  onRemove: (row: RepertoireRow) => void;
  /** Recarga tras apuntar un ensayo: «Practiced» pasa a «Practiced today». */
  onLogged: (row: RepertoireRow) => void | Promise<void>;
}) {
  return (
    <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <For each={props.rows}>
        {(row) => {
          // Consumo del modelo puro, fuera del JSX: el instante ya viene de la vista.
          const recency = practiceRecency(row, props.now);
          return (
            <li class="relative flex flex-col gap-3 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-600">
              {/*
                Fondo del tune (#31): la imagen elegida se pinta como fondo de la
                carta, recortada al focal guardado. Va en un `img` que cubre la
                carta —no en un marco— porque `loading="lazy"` solo existe en
                elementos `img`/`iframe`: un `background-image` de CSS se
                descargaría siempre, aunque la carta no se vea. El velo de encima
                mantiene legible el texto.
              */}
              <Show when={row.image}>
                {(image) => (
                  <>
                    <img
                      src={image().thumbUrl ?? ''}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
                      style={{ 'object-position': focalPosition(image().focalX, image().focalY) }}
                    />
                    <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/85 to-gray-950/30" />
                  </>
                )}
              </Show>
              <div class="relative flex flex-col gap-3">
                <div
                  class="flex h-12 w-12 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-sm font-semibold text-amber-300"
                  aria-hidden="true"
                >
                  {placeholderInitials(row)}
                </div>
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <A
                      href={`/repertoire/${row.id}`}
                      class="block truncate font-medium text-gray-100 hover:text-amber-300"
                      title={displayTitle(row)}
                    >
                      {displayTitle(row)}
                    </A>
                    <p class="text-xs text-gray-500">
                      {row.tune.origin}
                      {row.tune.origin_ref ? ` #${row.tune.origin_ref}` : ''}
                    </p>
                  </div>
                  <span
                    class={`inline-block shrink-0 rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[row.status]}`}
                  >
                    {STATUS_LABELS[row.status]}
                  </span>
                </div>
                <dl class="space-y-1 text-sm">
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-gray-500">Rhythm</dt>
                    <dd class="text-gray-300">{displayRhythm(row)}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-gray-500">Key</dt>
                    <dd class="text-gray-300">{displayKey(row)}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-gray-500">Added</dt>
                    <dd class="text-gray-400">{new Date(row.added_at).toLocaleDateString()}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-gray-500">Practiced</dt>
                    <dd class="text-gray-400">{recency.label}</dd>
                  </div>
                  <Show when={row.rating !== null}>
                    <div class="flex items-baseline justify-between gap-3">
                      <dt class="text-gray-500">Rating</dt>
                      <dd class="text-amber-300">★ {row.rating}</dd>
                    </div>
                  </Show>
                </dl>
                <div class="mt-auto flex items-center justify-between gap-2">
                  <PracticeLog repertoireId={row.id} onLogged={() => props.onLogged(row)} />
                  <button
                    type="button"
                    disabled={props.busyId === row.id}
                    class="text-xs text-gray-500 hover:text-red-300 disabled:opacity-60"
                    onClick={() => props.onRemove(row)}
                  >
                    {props.busyId === row.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

export default function Repertoire() {
  // Un único instante por renderizado de la vista: las etiquetas de «N days ago»
  // de todas las cards hablan del mismo día. Nunca dentro de la función pura.
  const now = Date.now();

  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | number | null>(null);
  const [showCatalogue, setShowCatalogue] = createSignal(false);

  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<CatalogueEntry[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchMs, setSearchMs] = createSignal<number | null>(null);
  const [catalogueError, setCatalogueError] = createSignal<string | null>(null);
  const [catalogueReady, setCatalogueReady] = createSignal(false);
  const [tuneCount, setTuneCount] = createSignal<number | null>(null);

  // La vista arranca con lo guardado en la sesión de esta pestaña.
  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  // El orden por defecto es la urgencia: este corte existe para decidir qué ensayar.
  const [sortKey, setSortKey] = createSignal<SortKey>('urgency');

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    rememberViewMode(mode);
  };

  const tokens = createMemo(() => tokenizeQuery(query()));

  /** Las filas en el orden elegido; ambas vistas consumen este memo. */
  const visible = createMemo(() => sortRepertoire(rows(), sortKey()));

  const viewButtonClass = (mode: ViewMode) =>
    `px-3 py-1.5 text-sm ${
      viewMode() === mode
        ? 'bg-amber-500 font-medium text-gray-900'
        : 'text-gray-300 hover:text-amber-300'
    }`;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRepertoire());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Recarga silenciosa tras apuntar un ensayo: no vuelve a poner `loading` para
   * que el grid no parpadee justo cuando se cierra el panel. El instante `now` no
   * se recalcula: la etiqueta pasa a «Practiced today» con la misma referencia.
   */
  const reload = async () => {
    try {
      setRows(await fetchRepertoire());
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
      setRows(await fetchRepertoire());
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
      setRows(await fetchRepertoire());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-100">Your repertoire</h2>
          <p class="text-sm text-gray-400">
            <Show when={!loading()} fallback="Loading…">
              {rows().length} {rows().length === 1 ? 'tune' : 'tunes'}
            </Show>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-gray-400" for="repertoire-sort">
            Sort by
            <select
              id="repertoire-sort"
              class="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
              value={sortKey()}
              onChange={(event) => setSortKey(event.currentTarget.value as SortKey)}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option value={key}>{SORT_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <div
            class="flex overflow-hidden rounded border border-gray-600"
            role="group"
            aria-label="Repertoire view"
          >
            <button
              type="button"
              class={viewButtonClass('table')}
              aria-pressed={viewMode() === 'table'}
              onClick={() => chooseView('table')}
            >
              Table
            </button>
            <button
              type="button"
              class={viewButtonClass('grid')}
              aria-pressed={viewMode() === 'grid'}
              onClick={() => chooseView('grid')}
            >
              Grid
            </button>
          </div>
          <button
            type="button"
            class="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
            onClick={() => setShowCatalogue((open) => !open)}
          >
            {showCatalogue() ? 'Close catalogue' : 'Add tunes'}
          </button>
        </div>
      </div>

      <Show when={error()}>
        <p class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={showCatalogue()}>
        <section class="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <div class="mb-3 space-y-2">
            <label class="block text-sm font-medium text-amber-300" for="catalogue-search">
              Search the tune catalogue
            </label>
            <input
              id="catalogue-search"
              type="search"
              autocomplete="off"
              placeholder="Name or any alternative title — e.g. butterfly, red admiral…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="w-full rounded bg-gray-900 border border-gray-600 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
            <p class="text-xs text-gray-500">
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
                <span class="text-red-300">{catalogueError()}</span>
              </Show>
            </p>
          </div>

          <Show when={!catalogueReady()}>
            <p class="text-sm text-gray-400">Loading the catalogue (4.5 MB, downloaded once)…</p>
          </Show>

          <Show when={catalogueReady() && query().trim().length > 0}>
            <Show
              when={results().length > 0}
              fallback={
                <p class="text-sm text-gray-400">
                  {searching() ? 'Searching…' : 'No tune matches that search.'}
                </p>
              }
            >
              <ul class="divide-y divide-gray-700">
                <For each={results()}>
                  {(entry) => {
                    const alias = aliasExcerpt(entry, tokens());
                    const viaAlias = matchedViaAlias(entry, tokens());
                    const owned = () => ownedRefs().has(String(entry.tuneId));
                    return (
                      <li class="flex items-start justify-between gap-3 py-2">
                        <div class="min-w-0">
                          <p class="truncate text-gray-100">{normalizeTitle(entry.name)}</p>
                          <p class="text-xs text-gray-500">
                            {entry.type ?? '—'}
                            {entry.meter ? ` · ${entry.meter}` : ''}
                            <span class="text-gray-600"> · thesession #{entry.tuneId}</span>
                          </p>
                          <Show when={viaAlias && alias}>
                            <p class="text-xs text-gray-400">
                              Also known as <span class="text-amber-300">{alias}</span>
                            </p>
                          </Show>
                        </div>
                        <button
                          type="button"
                          disabled={busyId() === entry.tuneId || owned()}
                          class="shrink-0 rounded border border-gray-600 px-3 py-1 text-sm text-gray-200 hover:border-amber-500 hover:text-amber-300 disabled:opacity-60"
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
            <p class="text-sm text-gray-400">
              Type a name — or an alternative one. The search looks at titles and at every
              alternative title in the catalogue.
            </p>
          </Show>
        </section>
      </Show>

      <Show
        when={!loading()}
        fallback={<p class="text-sm text-gray-400">Loading your repertoire…</p>}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <div class="rounded-lg border border-dashed border-gray-700 bg-gray-800/50 p-8 text-center">
              <p class="text-gray-300">Your repertoire is empty.</p>
              <p class="text-sm text-gray-500 mt-1">
                Open the catalogue and add the first tune you want to keep track of.
              </p>
            </div>
          }
        >
          <Show
            when={viewMode() === 'grid'}
            fallback={<RepertoireTable rows={visible()} busyId={busyId()} onRemove={remove} />}
          >
            <GridView rows={visible()} now={now} busyId={busyId()} onRemove={remove} onLogged={reload} />
          </Show>
        </Show>
      </Show>
    </div>
  );
}