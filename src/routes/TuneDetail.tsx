import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import {
  BANDS,
  STATUS_LABELS,
  STATUS_STYLES,
  bandFor,
  displayKey,
  displayRhythm,
  displayTitle,
  imageCredit,
  overrideFields,
  placeholderInitials,
  practiceRecency,
  type RepertoireRow,
  type TuneStatus,
} from '../lib/repertoire-model';
import {
  fetchRepertoireRow,
  removeFromRepertoire,
  saveShelved,
  saveStatus,
} from '../lib/repertoire';
import { focalPosition } from '../lib/image-sources';
import { formatDate } from '../lib/format';
import PracticeLog from '../components/PracticeLog';
import BackgroundPicker from '../components/BackgroundPicker';

/**
 * Detalle de un tune del repertorio (#7, corte 2), en ruta propia
 * `/repertoire/:id`. El id es el uuid de `pr_repertoire`, nunca el `origin_ref`
 * de TheSession: cada usuario tiene su propia fila para el mismo tune.
 *
 * La vista solo consume el modelo puro: días desde el último ensayo, iniciales y
 * marca de overrides salen de `repertoire-model`, y el instante de referencia se
 * toma una vez, al montar, para que toda la pantalla hable del mismo «hoy».
 */
export default function TuneDetail() {
  const params = useParams();
  const navigate = useNavigate();

  // Un único instante por carga: la etiqueta de días y la fecha de alta no pueden
  // discrepar por un cambio de día a media carga. Se refresca al cambiar de tune.
  const [now, setNow] = createSignal(Date.now());

  const [row, setRow] = createSignal<RepertoireRow | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal(false);
  const [savingLevel, setSavingLevel] = createSignal(false);
  const [savingShelved, setSavingShelved] = createSignal(false);

  /**
   * `params.id` se lee DENTRO del efecto: el router reutiliza la instancia al
   * navegar de `/repertoire/a` a `/repertoire/b`, así que capturar el id una vez
   * dejaba la primera fila en pantalla. Con la lectura reactiva, cada id tiene su
   * carga y una respuesta tardía de la anterior no pisa a la nueva.
   */
  createEffect(() => {
    const id = params.id;
    let cancelled = false;

    setRow(null);
    setError(null);
    setNow(Date.now());

    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchRepertoireRow(id)
      .then((found) => {
        if (!cancelled) setRow(found);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  /**
   * Recarga silenciosa tras apuntar un ensayo (#10): el «Last practiced» tiene
   * que pasar a «Practiced today» sin salir de la página. El instante se refresca
   * con la fila para que la etiqueta de días siga hablando de ahora mismo.
   */
  const reload = async (id: string) => {
    try {
      setRow(await fetchRepertoireRow(id));
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /** Enlace a TheSession: solo cuando el tune viene de ahí y trae referencia. */
  const sessionUrl = (item: RepertoireRow): string | null =>
    item.tune.origin === 'thesession' && item.tune.origin_ref
      ? `https://thesession.org/tunes/${item.tune.origin_ref}`
      : null;

  const remove = async (item: RepertoireRow) => {
    setRemoving(true);
    setError(null);
    try {
      await removeFromRepertoire(item.id);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoving(false);
    }
  };

  /**
   * El peldaño se cambia a mano (#11), aquí y solo aquí: no hay gesto sobre la
   * banda ni control en el menú de la carta. Se guarda y se relee la fila —el
   * mismo camino que el fondo y los ensayos— para que la pantalla enseñe lo que
   * hay en la base y no lo que creíamos haber escrito.
   */
  const changeLevel = async (item: RepertoireRow, status: TuneStatus) => {
    if (status === item.status) return;
    setSavingLevel(true);
    setError(null);
    try {
      await saveStatus(item.id, status);
      await reload(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingLevel(false);
    }
  };

  /** Aparcar no toca el peldaño: solo mueve la fila al cajón fuera de rotación. */
  const changeShelved = async (item: RepertoireRow, shelved: boolean) => {
    setSavingShelved(true);
    setError(null);
    try {
      await saveShelved(item.id, shelved);
      await reload(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingShelved(false);
    }
  };

  return (
    <div class="space-y-6">
      <A href="/" class="text-sm text-gray-400 hover:text-amber-300">
        Back to repertoire
      </A>

      <Show when={error()}>
        <p class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="text-sm text-gray-400">Loading…</p>}>
        <Show
          when={row()}
          fallback={
            /**
             * El «no está en tu repertorio» solo vale si la carga fue bien: con un
             * error de red la fila también es null, y decir que la tune no existe
             * sería mentir sobre la causa.
             */
            <Show when={!error()}>
              <div class="rounded-lg border border-dashed border-gray-700 bg-gray-800/50 p-8 text-center">
                <p class="text-gray-300">That tune is not in your repertoire.</p>
                <A href="/" class="mt-2 inline-block text-sm text-amber-300 hover:text-amber-200">
                  Back to repertoire
                </A>
              </div>
            </Show>
          }
        >
          {(item) => {
            // Una sola pasada por el modelo puro: el JSX no calcula nada. La fila
            // se recarga al apuntar un ensayo, así que todo lo derivado de ella va
            // en memos: el callback de `Show` no se re-ejecuta al cambiar el valor.
            const flags = createMemo(() => overrideFields(item()));
            const recency = createMemo(() => practiceRecency(item(), now()));
            const external = createMemo(() => sessionUrl(item()));
            /** El peldaño actual con su definición canónica: la del modelo, no una nueva. */
            const level = createMemo(() => bandFor(item().status));

            return (
              <article class="space-y-6 rounded-lg border border-gray-700 bg-gray-900 p-6">
                <header class="flex flex-wrap items-start gap-4">
                  <div
                    class="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-lg font-semibold text-amber-300"
                    aria-hidden="true"
                  >
                    {placeholderInitials(item())}
                  </div>
                  <div class="min-w-0 flex-1">
                    <h2
                      class="truncate text-xl font-semibold text-gray-100"
                      title={flags().title ? 'Custom value' : displayTitle(item())}
                    >
                      {displayTitle(item())}
                      <Show when={flags().title}>
                        <span class="ml-1 align-top text-amber-400" title="Custom value">
                          *
                        </span>
                      </Show>
                    </h2>
                    <p class="text-xs text-gray-500">
                      {item().tune.origin}
                      {item().tune.origin_ref ? ` #${item().tune.origin_ref}` : ''}
                    </p>
                  </div>
                  {/*
                    Peldaño de capacidad (#11): el badge de antes era de solo
                    lectura y por eso todas las tunes se quedaban en `to_learn`.
                    Ahora se elige aquí y la definición de al lado sale de BANDS:
                    las cuatro definiciones son canónicas y no se reescriben.
                  */}
                  <div class="flex shrink-0 flex-wrap items-center gap-3">
                    <select
                      aria-label="Level"
                      disabled={savingLevel()}
                      value={item().status}
                      class={`rounded border px-2 py-0.5 text-xs disabled:opacity-60 ${STATUS_STYLES[item().status]}`}
                      onChange={(event) =>
                        void changeLevel(item(), event.currentTarget.value as TuneStatus)
                      }
                    >
                      <For each={BANDS}>
                        {(band) => <option value={band.status}>{STATUS_LABELS[band.status]}</option>}
                      </For>
                    </select>
                    <span class="max-w-[17rem] text-xs text-gray-400 italic">{level().definition}</span>
                  </div>
                </header>

                {/*
                  Aparcada (#11): bandera transversal, no un quinto peldaño. Marcar
                  la casilla no cambia el nivel; solo la saca de rotación, y la
                  home deja de contarla en su banda para pintarla en el cajón.
                */}
                <div class="space-y-1">
                  <label class="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={item().shelved}
                      disabled={savingShelved()}
                      onChange={(event) => void changeShelved(item(), event.currentTarget.checked)}
                    />
                    Shelved — out of rotation
                  </label>
                  <Show when={item().shelved}>
                    <p class="text-xs text-gray-500">
                      Keeps its level ({level().label}) and stays out of rotation.
                    </p>
                  </Show>
                </div>

                {/*
                  Fondo del tune (#31): se pinta aquí, recortado al focal guardado,
                  con el crédito debajo —autor · licencia, con enlace a la ficha—.
                  Sin fondo, esta pieza no existe y el detalle queda como estaba.
                */}
                <Show when={item().image}>
                  {(image) => (
                    <figure class="space-y-1">
                      <div class="relative h-40 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-800">
                        <img
                          src={image().fullUrl ?? image().thumbUrl ?? ''}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          decoding="async"
                          class="h-full w-full object-cover"
                          style={{ 'object-position': focalPosition(image().focalX, image().focalY) }}
                        />
                      </div>
                      <figcaption class="text-xs text-gray-400">
                        {imageCredit(image())}
                        <Show when={image().pageUrl}>
                          {' · '}
                          <a
                            href={image().pageUrl!}
                            target="_blank"
                            rel="noreferrer"
                            class="text-amber-300 hover:text-amber-200"
                          >
                            Source
                          </a>
                        </Show>
                      </figcaption>
                    </figure>
                  )}
                </Show>

                <dl class="grid gap-3 text-sm sm:grid-cols-2">
                  <div class="flex items-baseline justify-between gap-3 sm:justify-start">
                    <dt class="text-gray-500">
                      Rhythm
                      <Show when={flags().rhythm}>
                        <span class="ml-1 text-amber-400" title="Custom value">
                          *
                        </span>
                      </Show>
                    </dt>
                    <dd class="text-gray-200" title={flags().rhythm ? 'Custom value' : undefined}>
                      {displayRhythm(item())}
                    </dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3 sm:justify-start">
                    <dt class="text-gray-500">
                      Key
                      <Show when={flags().key}>
                        <span class="ml-1 text-amber-400" title="Custom value">
                          *
                        </span>
                      </Show>
                    </dt>
                    <dd class="text-gray-200" title={flags().key ? 'Custom value' : undefined}>
                      {displayKey(item())}
                    </dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-3 sm:justify-start">
                    <dt class="text-gray-500">Meter</dt>
                    <dd class="text-gray-200">{item().tune.meter ?? '—'}</dd>
                  </div>
                </dl>

                <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
                  <span>
                    Added <span class="text-gray-300">{formatDate(item().added_at)}</span>
                  </span>
                  <span>
                    Last practiced{' '}
                    <span class="text-gray-300" title={formatDate(item().last_practiced_at)}>
                      {recency().label}
                    </span>
                  </span>
                  <Show when={item().rating !== null}>
                    <span class="text-amber-300">★ {item().rating}</span>
                  </Show>
                </p>

                <Show
                  when={item().notes}
                  fallback={<p class="text-sm text-gray-500">No notes for this tune.</p>}
                >
                  {(notes) => (
                    <section class="space-y-2">
                      <h3 class="text-xs uppercase tracking-wide text-gray-500">Notes</h3>
                      <p class="rounded border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm whitespace-pre-wrap text-gray-200">
                        {notes()}
                      </p>
                    </section>
                  )}
                </Show>

                <Show when={external()}>
                  {(url) => (
                    <p class="text-sm">
                      <a
                        href={url()}
                        rel="noreferrer"
                        target="_blank"
                        class="text-amber-300 hover:text-amber-200"
                      >
                        Open on TheSession
                      </a>
                    </p>
                  )}
                </Show>

                <BackgroundPicker
                  repertoireId={item().id}
                  title={displayTitle(item())}
                  image={item().image}
                  onSaved={() => reload(item().id)}
                />

                <div class="flex items-center justify-between gap-3 border-t border-gray-800 pt-4">
                  <A href="/" class="text-sm text-gray-400 hover:text-amber-300">
                    Back to repertoire
                  </A>
                  <div class="flex flex-wrap items-center gap-3">
                    <PracticeLog
                      repertoireId={item().id}
                      onLogged={() => reload(item().id)}
                    />
                    <button
                      type="button"
                      disabled={removing()}
                      class="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:border-red-500 hover:text-red-300 disabled:opacity-60"
                      onClick={() => void remove(item())}
                    >
                      {removing() ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              </article>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
