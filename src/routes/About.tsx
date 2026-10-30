import { Show, createResource } from 'solid-js';
import { getCatalogueMeta, getCatalogueStats } from '../lib/catalogue-db';
import { formatDate } from '../lib/format';

/**
 * «Acerca de»: procedencia y tamaño del catálogo (criterio de la issue #4).
 *
 * Los números se leen del artefacto abierto en el navegador (`getCatalogueStats`)
 * y del sidecar de procedencia (`thesession.meta.json`), no de constantes
 * copiadas a mano: si la copia cambia, esta pantalla cambia con ella.
 */
export default function About() {
  const [stats] = createResource(getCatalogueStats);
  const [meta] = createResource(getCatalogueMeta);

  return (
    <div class="space-y-6 max-w-3xl">
      <div>
        <h2 class="text-xl font-semibold text-gray-100">About</h2>
        <p class="text-sm text-gray-400">
          TradTracker — Irish traditional music practice manager.
        </p>
      </div>

      <section class="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 class="font-medium text-amber-300 mb-3">Tune catalogue</h3>

        <Show
          when={stats()}
          fallback={
            <Show when={stats.error} fallback={<p class="text-sm text-gray-400">Reading the catalogue…</p>}>
              <p class="text-sm text-red-300">
                {stats.error instanceof Error ? stats.error.message : String(stats.error)}
              </p>
            </Show>
          }
        >
          {(data) => (
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt class="text-gray-400">Tunes</dt>
              <dd class="text-gray-100">{data().tunes.toLocaleString()}</dd>

              <dt class="text-gray-400">With alternative titles</dt>
              <dd class="text-gray-100">{data().withAliases.toLocaleString()}</dd>

              <dt class="text-gray-400">Catalogue copied</dt>
              <dd class="text-gray-100">
                {meta()?.copied_at ? formatDate(meta()!.copied_at) : 'unknown'}
              </dd>

              <dt class="text-gray-400">Source</dt>
              <dd class="text-gray-100">
                <Show when={meta()?.source_repo} fallback="crivote/tradtube">
                  {meta()!.source_repo}
                </Show>
                <Show when={meta()?.source_commit}>
                  {' · '}
                  <span class="font-mono text-xs text-gray-400">
                    {meta()!.source_commit!.slice(0, 8)}
                  </span>
                </Show>
              </dd>

              <dt class="text-gray-400">Checksum</dt>
              <dd class="font-mono text-xs text-gray-400 break-all">
                {meta()?.sha256 ? `sha256 ${meta()!.sha256.slice(0, 16)}…` : 'unknown'}
              </dd>
            </dl>
          )}
        </Show>

        <p class="mt-4 text-xs text-gray-500">
          The catalogue ships with the app as a SQLite file and is searched on your device
          (FTS5 over titles and alternative titles). It holds no ABC notation and no keys,
          so scores and backing tracks are not derived from it.
        </p>

        <p class="mt-2 text-xs text-gray-500">
          Tune backgrounds come from Wikimedia Commons and, if you paste your own key, from
          Pexels. Each image keeps its own licence and author, shown with the image — public
          domain and CC0 ones are marked in green; nothing is copied into this app.
        </p>
      </section>
    </div>
  );
}
