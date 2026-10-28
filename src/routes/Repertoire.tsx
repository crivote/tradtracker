import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  addCatalogueTune,
  displayKey,
  displayRhythm,
  displayTitle,
  fetchRepertoire,
  removeFromRepertoire,
  type RepertoireRow,
} from '../lib/repertoire';
import {
  aliasExcerpt,
  matchedViaAlias,
  tokenizeQuery,
  type CatalogueEntry,
} from '../lib/catalogue';
import { preloadCatalogue, searchCatalogue, getCatalogueStats } from '../lib/catalogue-db';
import { normalizeTitle } from '../lib/format';

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
 */
export default function Repertoire() {
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

  const tokens = createMemo(() => tokenizeQuery(query()));

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
        <button
          type="button"
          class="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
          onClick={() => setShowCatalogue((open) => !open)}
        >
          {showCatalogue() ? 'Close catalogue' : 'Add tunes'}
        </button>
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
                <For each={rows()}>
                  {(row) => (
                    <tr class="hover:bg-gray-800/60">
                      <td class="px-4 py-3">
                        <p class="text-gray-100">{displayTitle(row)}</p>
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
                          disabled={busyId() === row.id}
                          class="text-xs text-gray-500 hover:text-red-300 disabled:opacity-60"
                          onClick={() => void remove(row)}
                        >
                          {busyId() === row.id ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  );
}
