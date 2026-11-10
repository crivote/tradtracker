import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import {
  LEVEL_OPTIONS,
  STATUS_LABELS,
  addCatalogueTune,
  type LearningSlots,
  type TuneStatus,
} from '../lib/repertoire';
import {
  aliasExcerpt,
  matchedViaAlias,
  tokenizeQuery,
  type CatalogueEntry,
} from '../lib/catalogue';
import {
  getCatalogueStats,
  lookupCatalogueMeta,
  preloadCatalogue,
  searchCatalogue,
} from '../lib/catalogue-db';
import { normalizeTitle } from '../lib/format';
import ImportFromSession from './ImportFromSession';

/**
 * El alta de tunes (#9, #29, corte de pantallas): un **cajón lateral**, no un
 * panel en línea.
 *
 * El panel en línea empujaba la escalera entera hacia abajo cada vez que se
 * abría y competía con la pantalla que se estaba mirando: añadir una tune es una
 * gestión, no el contenido del repertorio. Aquí vive al margen —cajón a la
 * derecha, sobre papel, con el fondo velado— y la pantalla no se mueve.
 *
 * Tres decisiones que se ven en el marcado:
 *   · **El nivel se elige antes de añadir** y vale para todas las altas de la
 *     sesión de cajón. Antes toda tune nacía en el backlog y había que moverla
 *     después con un segundo gesto; ahora una tune que se añade para trabajarla
 *     entra directamente donde se va a trabajar.
 *   · **El peldaño `learning` avisa del tope** sin bloquear: el tope del banco de
 *     trabajo es un consejo, no una puerta —bajarlo tampoco mueve filas—, pero
 *     callarlo dejaría al dueño con ocho tunes en una pantalla de seis plazas.
 *   · **La importación del tunebook vive aquí dentro**: era la otra puerta de
 *     entrada al repertorio y ocupaba su propio botón en la cabecera.
 */

export interface AddTuneAsideProps {
  /** `origin_ref` de los tunes que ya están en el repertorio. */
  existingRefs: Set<string>;
  /** Ocupación del banco de trabajo, para avisar si se añade a `learning`. */
  slots: LearningSlots;
  /** Recarga del repertorio tras cada alta. */
  onAdded: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * Adónde lleva «verlas» después de añadir: `learning` tiene pantalla propia y el
 * resto de peldaños —el backlog incluido— se miran en el listado.
 */
export function levelHref(status: TuneStatus): string {
  return status === 'learning' ? '/learning' : `/level/${status}`;
}

export default function AddTuneAside(props: AddTuneAsideProps) {
  let panel: HTMLDivElement | undefined;
  let searchBox: HTMLInputElement | undefined;

  const [level, setLevel] = createSignal<TuneStatus>('to_learn');
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<CatalogueEntry[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchMs, setSearchMs] = createSignal<number | null>(null);
  const [catalogueError, setCatalogueError] = createSignal<string | null>(null);
  const [catalogueReady, setCatalogueReady] = createSignal(false);
  const [tuneCount, setTuneCount] = createSignal<number | null>(null);
  const [busyId, setBusyId] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [added, setAdded] = createSignal<{ title: string; status: TuneStatus } | null>(null);
  /** Altas de esta sesión de cajón: `existingRefs` solo se refresca al recargar. */
  const [addedHere, setAddedHere] = createSignal<ReadonlySet<number>>(new Set());

  const tokens = createMemo(() => tokenizeQuery(query()));
  const chosen = createMemo(() => LEVEL_OPTIONS.find((band) => band.status === level())!);

  const owned = (entry: CatalogueEntry): boolean =>
    props.existingRefs.has(String(entry.tuneId)) || addedHere().has(entry.tuneId);

  const message = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause);

  /**
   * El cajón no atrapa el foco del navegador de serie: se hace aquí, porque es
   * `aria-modal` y prometer un modal sin retener el tabulador deja al lector
   * paseando por la pantalla de detrás sin verlo.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')
    ).filter((element) => !element.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  onMount(() => {
    // Al cerrar, el foco vuelve a donde estaba: abrir un modal y dejarlo en el
    // `body` obliga a recorrer la cabecera otra vez con el teclado.
    const opener = document.activeElement as HTMLElement | null;
    searchBox?.focus();
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    });

    // El artefacto se descarga una vez y se reutiliza: si la pantalla ya lo
    // pidió, esto resuelve al instante.
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
        setCatalogueError(message(cause));
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
        setCatalogueError(message(cause));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  const add = async (entry: CatalogueEntry) => {
    setBusyId(entry.tuneId);
    setError(null);
    setAdded(null);
    try {
      // El autor no viaja en el resultado del buscador; sí en la consulta por id
      // del catálogo (#44). Sin este viaje la tune nace sin autor y el subtexto
      // —tipo · compás · autor— queda cojo hasta el próximo relleno.
      const meta = await lookupCatalogueMeta([entry.tuneId]);
      await addCatalogueTune(
        {
          tuneId: entry.tuneId,
          name: entry.name,
          rhythm: entry.type,
          meter: entry.meter,
          composer: meta.get(entry.tuneId)?.composer ?? null,
        },
        level()
      );
      setAddedHere((previous) => new Set([...previous, entry.tuneId]));
      setAdded({ title: normalizeTitle(entry.name), status: level() });
      await props.onAdded();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div class="drawer-layer">
      {/* El velo cierra el cajón; no lleva nombre accesible porque repetiría el
          del botón de cerrar. */}
      <div class="drawer-veil" onClick={props.onClose} aria-hidden="true" />

      <aside
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-tune-heading"
        ref={panel}
      >
        <header class="drawer-head">
          <h2 id="add-tune-heading">Add tunes</h2>
          <button type="button" class="drawer-close" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </header>

        <div class="drawer-body">
          {/* El nivel del alta. Va antes del buscador porque decide dónde cae lo
              que se añada, y con su definición escrita al lado: «Shaky» y
              «Playing along» no significan nada sin la frase. */}
          <label for="add-level">Add as</label>
          <select
            id="add-level"
            value={level()}
            onChange={(event) => setLevel(event.currentTarget.value as TuneStatus)}
          >
            <For each={LEVEL_OPTIONS}>
              {(band) => <option value={band.status}>{STATUS_LABELS[band.status]}</option>}
            </For>
          </select>
          <p class="rung-def">{chosen().definition}</p>
          <Show when={level() === 'learning'}>
            <p class="hint" classList={{ 'hint--over': props.slots.over > 0 }}>
              Workbench: {props.slots.used} of {props.slots.limit} slots
              <Show when={props.slots.over > 0}> · over by {props.slots.over}</Show>
              <Show when={props.slots.free > 0}> · {props.slots.free} free</Show>
            </p>
          </Show>

          <Show when={added()}>
            {(last) => (
              <p class="drawer-added" role="status">
                <b>{last().title}</b> added as {STATUS_LABELS[last().status]} ·{' '}
                <A href={levelHref(last().status)} onClick={props.onClose}>
                  See {STATUS_LABELS[last().status].toLowerCase()}
                </A>
              </p>
            )}
          </Show>

          <Show when={error()}>
            <p class="notice notice-error" role="alert">
              {error()}
            </p>
          </Show>

          <label for="catalogue-search">Search the tune catalogue</label>
          <input
            id="catalogue-search"
            ref={searchBox}
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
              <ul class="cat-list">
                <For each={results()}>
                  {(entry) => {
                    const alias = aliasExcerpt(entry, tokens());
                    const viaAlias = matchedViaAlias(entry, tokens());
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
                          disabled={busyId() === entry.tuneId || owned(entry)}
                          onClick={() => void add(entry)}
                        >
                          {owned(entry)
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

          {/* La otra puerta de entrada al repertorio. Plegada: el buscador es el
              gesto de todos los días y el tunebook se importa una vez. */}
          <details class="drawer-import">
            <summary>Import a tunebook from The Session</summary>
            <ImportFromSession
              existingRefs={props.existingRefs}
              onImported={() => void props.onAdded()}
              onClose={props.onClose}
            />
          </details>
        </div>
      </aside>
    </div>
  );
}
