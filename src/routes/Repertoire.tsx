import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  addToRepertoire,
  displayKey,
  displayRhythm,
  displayTitle,
  fetchCatalogue,
  fetchRepertoire,
  removeFromRepertoire,
  type RepertoireRow,
  type TuneRecord,
} from '../lib/repertoire';
import { normalizeTitle } from '../lib/format';

/**
 * Vista de la colección: la lectura que ejercita el join pr_repertoire → pr_tunes
 * con la RLS del usuario que ha iniciado sesión.
 *
 * El alta es deliberadamente mínima: el catálogo completo llega con la issue #4
 * (SQLite WASM + FTS5) y la vista rica de cards con la #7. Aquí solo se puede
 * añadir de entre las tunes que ya existen en pr_tunes.
 */
export default function Repertoire() {
  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [catalogue, setCatalogue] = createSignal<TuneRecord[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal('');
  const [showCatalogue, setShowCatalogue] = createSignal(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [repertoire, tunes] = await Promise.all([fetchRepertoire(), fetchCatalogue()]);
      setRows(repertoire);
      setCatalogue(tunes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  const ownedIds = createMemo(() => new Set(rows().map((row) => row.tune.id)));

  const available = createMemo(() => {
    const term = filter().trim().toLowerCase();
    return catalogue()
      .filter((tune) => !ownedIds().has(tune.id))
      .filter((tune) => (term ? normalizeTitle(tune.name).toLowerCase().includes(term) : true));
  });

  const add = async (tune: TuneRecord) => {
    setBusyId(tune.id);
    setError(null);
    try {
      await addToRepertoire(tune.id);
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
          <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 class="font-medium text-amber-300">Catalogue</h3>
            <input
              type="search"
              placeholder="Filter tunes…"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              class="rounded bg-gray-900 border border-gray-600 px-3 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <Show
            when={available().length > 0}
            fallback={<p class="text-sm text-gray-400">Nothing left to add from the catalogue.</p>}
          >
            <ul class="divide-y divide-gray-700">
              <For each={available()}>
                {(tune) => (
                  <li class="flex items-center justify-between gap-3 py-2">
                    <div class="min-w-0">
                      <p class="truncate text-gray-100">{normalizeTitle(tune.name)}</p>
                      <p class="text-xs text-gray-500">
                        {tune.rhythm ?? '—'}
                        {tune.meter ? ` · ${tune.meter}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId() === tune.id}
                      class="shrink-0 rounded border border-gray-600 px-3 py-1 text-sm text-gray-200 hover:border-amber-500 hover:text-amber-300 disabled:opacity-60"
                      onClick={() => void add(tune)}
                    >
                      {busyId() === tune.id ? 'Adding…' : 'Add'}
                    </button>
                  </li>
                )}
              </For>
            </ul>
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
                        <p class="text-xs text-gray-500">{row.tune.origin}</p>
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
