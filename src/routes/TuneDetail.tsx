import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import {
  BANDS,
  OVERRIDE_FIELDS,
  STATUS_LABELS,
  STATUS_STYLES,
  applyPatchToDrafts,
  bandFor,
  customDrafts,
  displayKey,
  displayRhythm,
  displayTitle,
  imageCredit,
  normalizeOverride,
  overrideFields,
  placeholderInitials,
  practiceRecency,
  type OverrideField,
  type RepertoireRow,
  type TuneStatus,
} from '../lib/repertoire-model';
import {
  fetchRepertoireRow,
  removeFromRepertoire,
  saveOverrides,
  saveShelved,
  saveStatus,
} from '../lib/repertoire';
import { focalPosition } from '../lib/image-sources';
import { formatDate } from '../lib/format';
import { facetTree, tagsForTune, type Tag, type TagFacetInfo } from '../lib/tags';
import {
  addTuneTags,
  fetchTuneTags,
  fetchVocabulary,
  removeTuneTag,
  type TagVocabulary,
} from '../lib/tags-db';
import PracticeLog from '../components/PracticeLog';
import BackgroundPicker from '../components/BackgroundPicker';

/**
 * El vocabulario de etiquetas (F17, #48) es cerrado e inmutable: se pide **una
 * vez por sesión de navegador** y se comparte entre tunes —pedirlo por visita al
 * detalle sería una llamada por tune—. La promesa se guarda en vuelo, así que dos
 * montajes a la vez no lanzan dos peticiones.
 *
 * Un fallo **no** se cachea: se limpia la promesa y la siguiente visita vuelve a
 * intentarlo, en vez de dejar el bloque apagado para siempre por un corte de red
 * de hace media hora.
 */
let vocabularyPromise: Promise<TagVocabulary | null> | null = null;

function loadVocabulary(): Promise<TagVocabulary | null> {
  if (vocabularyPromise) return vocabularyPromise;
  const pending = fetchVocabulary().catch(() => {
    vocabularyPromise = null;
    return null;
  });
  vocabularyPromise = pending;
  return pending;
}

/**
 * Estilo de los campos del formulario de overrides (F2, #8): paleta oscura del
 * detalle, un solo sitio para las cuatro clases. El placeholder es gris apagado
 * a propósito —es el valor estándar, no lo que hay guardado—.
 */
const OVERRIDE_INPUT_CLASS =
  'w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 placeholder:text-gray-600 focus:border-amber-400 focus:outline-none disabled:opacity-60';
const OVERRIDE_STANDARD_CLASS =
  'shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-amber-400 hover:text-amber-300 disabled:opacity-60';

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

            /* ── Formulario de overrides (F2, #8) ──────────────────────────
             * Los borradores son estado de pantalla, no un dato del modelo: se
             * resiembran cuando cambia la fila (carga, recarga o escritura
             * propia) y nunca mientras se teclea, porque `item()` no cambia con
             * las pulsaciones.
             */
            const [editing, setEditing] = createSignal(false);
            const [drafts, setDrafts] = createSignal<Record<OverrideField, string>>(
              customDrafts(item())
            );
            const [savingOverrides, setSavingOverrides] = createSignal(false);
            const [overrideError, setOverrideError] = createSignal<string | null>(null);

            /**
             * La resiembra va **por fila**, no por cambio de la fila: `setRow` tras
             * una escritura también cambia `item()`, y resiembra entonces borraría lo
             * que el usuario tenga tecleado en otro campo (teclear el título y luego
             * pulsar «Use standard» en la tonalidad perdía el título). Cada escritura
             * normaliza su propio campo con `applyPatchToDrafts`.
             */
            let seededFor: string | null = null;
            createEffect(() => {
              const current = item();
              if (seededFor === current.id) return;
              seededFor = current.id;
              setDrafts(customDrafts(current));
            });

            /** Lo guardado, para saber qué campos tocó el usuario. */
            const storedDrafts = createMemo(() => customDrafts(item()));

            /**
             * Solo los campos cuyo borrador **difiere de lo guardado**, ya
             * normalizados: un guardado no reescribe los otros tres. Comparar
             * contra el valor guardado —y no contra el estándar— es lo que
             * distingue «no lo he tocado» de «quiero volver al estándar», que se
             * pide vaciando el campo.
             */
            const overridePatch = createMemo(() => {
              const stored = storedDrafts();
              const current = drafts();
              const patch: Partial<Record<OverrideField, string | null>> = {};
              for (const field of OVERRIDE_FIELDS) {
                if (current[field] === stored[field]) continue;
                patch[field] = normalizeOverride(current[field]);
              }
              return patch;
            });

            const hasOverrideChanges = createMemo(() => Object.keys(overridePatch()).length > 0);

            const setDraft = (field: OverrideField, value: string) =>
              setDrafts((previous) => ({ ...previous, [field]: value }));

            /**
             * Refleja lo escrito en la fila en pantalla: el `*`, el título y los
             * placeholders cambian sin volver a pedir la fila a Supabase, que es
             * lo único que el formulario no necesita.
             */
            const applyOverrides = (patch: Partial<Record<OverrideField, string | null>>) => {
              const current = item();
              const next: RepertoireRow = { ...current };
              if ('title' in patch) next.custom_title = patch.title ?? null;
              if ('rhythm' in patch) next.custom_rhythm = patch.rhythm ?? null;
              if ('key' in patch) next.custom_key = patch.key ?? null;
              if ('abc' in patch) next.customAbc = patch.abc ?? null;
              setRow(next);
            };

            const saveEdits = async (id: string) => {
              const patch = overridePatch();
              if (Object.keys(patch).length === 0) return;
              setSavingOverrides(true);
              setOverrideError(null);
              try {
                await saveOverrides(id, patch);
                applyOverrides(patch);
                // El borrador de lo escrito queda normalizado (`null` → vacío), o el
                // «Save» seguiría armado reescribiendo lo mismo.
                setDrafts((previous) => applyPatchToDrafts(previous, patch));
              } catch (cause) {
                setOverrideError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setSavingOverrides(false);
              }
            };

            /**
             * «Use standard»: un campo vuelve al valor del catálogo escribiendo
             * `null`. Va en su propia escritura y no en el `Save` del formulario
             * porque el gesto es inmediato y de un solo campo.
             */
            const useStandard = async (id: string, field: OverrideField) => {
              const patch: Partial<Record<OverrideField, string | null>> = {};
              patch[field] = null;
              setSavingOverrides(true);
              setOverrideError(null);
              try {
                await saveOverrides(id, patch);
                applyOverrides(patch);
                // El borrador de lo escrito queda normalizado (`null` → vacío), o el
                // «Save» seguiría armado reescribiendo lo mismo.
                setDrafts((previous) => applyPatchToDrafts(previous, patch));
              } catch (cause) {
                setOverrideError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setSavingOverrides(false);
              }
            };

            /* ── Etiquetas por facetas (F17, #48) ────────────────────────────
             * Vocabulario cerrado y común; asignación personal anclada a
             * `(user_id, tune_id)`. La vista no calcula el árbol al escribir:
             * marcar pasa por la RPC, que siembra los ancestros (`donegal` entra
             * con `ireland`), y lo que se pinta es siempre lo releído de la base.
             */
            const [vocabulary, setVocabulary] = createSignal<TagVocabulary | null>(null);
            const [assignedTags, setAssignedTags] = createSignal<Set<number>>(new Set<number>());
            const [loadingTags, setLoadingTags] = createSignal(true);
            const [savingTags, setSavingTags] = createSignal(false);
            const [tagError, setTagError] = createSignal<string | null>(null);

            /** Una sola petición por sesión de navegador; ver `loadVocabulary`. */
            createEffect(() => {
              void loadVocabulary().then((loaded) => setVocabulary(loaded));
            });

            /**
             * El árbol listo para pintar, o `null` si no hay vocabulario: sin
             * facetas el bloque **no** se pinta, porque un «Tags» vacío es un
             * hueco que promete algo que no hay.
             */
            const tagGroups = createMemo(() => {
              const loaded = vocabulary();
              if (!loaded || loaded.facets.length === 0) return null;
              return facetTree(loaded.facets, loaded.tags);
            });

            /** Etiquetas marcadas, tal y como están en la base. */
            const readTags = async (id: string) =>
              tagsForTune(await fetchTuneTags([id]), id);

            createEffect(() => {
              const id = item().id;
              let cancelled = false;

              setLoadingTags(true);
              setTagError(null);
              void readTags(id)
                .then((ids) => {
                  if (!cancelled) setAssignedTags(ids);
                })
                .catch((cause) => {
                  if (!cancelled) {
                    setTagError(cause instanceof Error ? cause.message : String(cause));
                  }
                })
                .finally(() => {
                  if (!cancelled) setLoadingTags(false);
                });

              onCleanup(() => {
                cancelled = true;
              });
            });

            /**
             * Marcar → RPC con ancestros; desmarcar → una fila. En los dos casos
             * se relee la tune entera: la base pudo sembrar ancestros, y la
             * pantalla tiene que enseñarlos.
             */
            const toggleTag = async (id: string, tagId: number, checked: boolean) => {
              setSavingTags(true);
              setTagError(null);
              try {
                if (checked) await addTuneTags([id], [tagId]);
                else await removeTuneTag(id, tagId);
                setAssignedTags(await readTags(id));
              } catch (cause) {
                setTagError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setSavingTags(false);
              }
            };

            /**
             * Dos etiquetas con el mismo texto en facetas distintas necesitan la
             * faceta en el nombre accesible; con texto único, el `aria-label` es
             * solo la etiqueta.
             */
            const repeatedLabels = createMemo(() => {
              const counts = new Map<string, number>();
              for (const tag of vocabulary()?.tags ?? []) {
                counts.set(tag.label, (counts.get(tag.label) ?? 0) + 1);
              }
              return new Set(
                [...counts].filter(([, times]) => times > 1).map(([label]) => label)
              );
            });

            const tagLabel = (tag: Tag, facet: TagFacetInfo) =>
              repeatedLabels().has(tag.label) ? `${facet.label}: ${tag.label}` : tag.label;

            /** Una casilla; los hijos van indentados bajo su raíz. */
            const tagBox = (tag: Tag, facet: TagFacetInfo, child = false) => (
              <label
                class={`flex items-center gap-2 text-sm ${child ? 'pl-4 text-gray-300' : 'text-gray-200'}`}
              >
                <input
                  type="checkbox"
                  class="accent-amber-400"
                  aria-label={tagLabel(tag, facet)}
                  checked={assignedTags().has(tag.id)}
                  disabled={savingTags()}
                  onChange={(event) =>
                    void toggleTag(item().id, tag.id, event.currentTarget.checked)
                  }
                />
                {tag.label}
              </label>
            );

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

                {/*
                  Overrides de metadatos (F2, #8). El estándar **no** se precarga:
                  se enseña como placeholder, así que un campo vacío significa
                  «usar el del catálogo» y no hay que adivinar si el texto guardado
                  coincide o no con él. El `*` de arriba sigue marcando lo que está
                  sobreescrito; aquí manda el «Use standard», que solo se pinta en
                  los campos que de verdad lo están.
                */}
                <section class="space-y-3 rounded border border-gray-700 bg-gray-800/40 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <h3 class="text-xs uppercase tracking-wide text-gray-500">Details</h3>
                    <button
                      type="button"
                      aria-expanded={editing()}
                      aria-controls="edit-details"
                      class="rounded border border-gray-600 px-3 py-1 text-sm text-gray-300 hover:border-amber-400 hover:text-amber-300"
                      onClick={() => setEditing(!editing())}
                    >
                      Edit details
                    </button>
                  </div>

                  <Show when={editing()}>
                    <form
                      id="edit-details"
                      class="space-y-3 border-t border-gray-700 pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdits(item().id);
                      }}
                    >
                      <p class="text-xs text-gray-500">
                        Leave a field empty to use the standard value.
                      </p>

                      <div class="space-y-1">
                        <span class="text-xs text-gray-400">Title</span>
                        <div class="flex items-start gap-2">
                          <input
                            type="text"
                            aria-label="Title"
                            placeholder={item().tune.name}
                            value={drafts().title}
                            disabled={savingOverrides()}
                            class={OVERRIDE_INPUT_CLASS}
                            onInput={(event) => setDraft('title', event.currentTarget.value)}
                          />
                          <Show when={flags().title}>
                            <button
                              type="button"
                              aria-label="Use standard title"
                              disabled={savingOverrides()}
                              class={OVERRIDE_STANDARD_CLASS}
                              onClick={() => void useStandard(item().id, 'title')}
                            >
                              Use standard
                            </button>
                          </Show>
                        </div>
                      </div>

                      <div class="space-y-1">
                        <span class="text-xs text-gray-400">Rhythm</span>
                        <div class="flex items-start gap-2">
                          <input
                            type="text"
                            aria-label="Rhythm"
                            placeholder={item().tune.rhythm ?? ''}
                            value={drafts().rhythm}
                            disabled={savingOverrides()}
                            class={OVERRIDE_INPUT_CLASS}
                            onInput={(event) => setDraft('rhythm', event.currentTarget.value)}
                          />
                          <Show when={flags().rhythm}>
                            <button
                              type="button"
                              aria-label="Use standard rhythm"
                              disabled={savingOverrides()}
                              class={OVERRIDE_STANDARD_CLASS}
                              onClick={() => void useStandard(item().id, 'rhythm')}
                            >
                              Use standard
                            </button>
                          </Show>
                        </div>
                      </div>

                      <div class="space-y-1">
                        <span class="text-xs text-gray-400">Key</span>
                        <div class="flex items-start gap-2">
                          <input
                            type="text"
                            aria-label="Key"
                            placeholder={item().tune.key ?? ''}
                            value={drafts().key}
                            disabled={savingOverrides()}
                            class={OVERRIDE_INPUT_CLASS}
                            onInput={(event) => setDraft('key', event.currentTarget.value)}
                          />
                          <Show when={flags().key}>
                            <button
                              type="button"
                              aria-label="Use standard key"
                              disabled={savingOverrides()}
                              class={OVERRIDE_STANDARD_CLASS}
                              onClick={() => void useStandard(item().id, 'key')}
                            >
                              Use standard
                            </button>
                          </Show>
                        </div>
                      </div>

                      <div class="space-y-1">
                        <span class="text-xs text-gray-400">ABC</span>
                        <div class="flex items-start gap-2">
                          <textarea
                            aria-label="ABC"
                            rows={5}
                            placeholder={item().tune.abc ?? ''}
                            value={drafts().abc}
                            disabled={savingOverrides()}
                            class={`${OVERRIDE_INPUT_CLASS} font-mono`}
                            onInput={(event) => setDraft('abc', event.currentTarget.value)}
                          />
                          <Show when={flags().abc}>
                            <button
                              type="button"
                              aria-label="Use standard ABC"
                              disabled={savingOverrides()}
                              class={OVERRIDE_STANDARD_CLASS}
                              onClick={() => void useStandard(item().id, 'abc')}
                            >
                              Use standard
                            </button>
                          </Show>
                        </div>
                      </div>

                      <div class="flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          disabled={savingOverrides() || !hasOverrideChanges()}
                          class="rounded bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-amber-400 disabled:opacity-50"
                        >
                          {savingOverrides() ? 'Saving…' : 'Save'}
                        </button>
                        <Show when={overrideError()}>
                          <p class="text-sm text-red-400" role="alert">
                            {overrideError()}
                          </p>
                        </Show>
                      </div>
                    </form>
                  </Show>
                </section>

                {/*
                  Etiquetas por facetas (#48). Van **después** de «Details»
                  porque clasifican la pieza, no editan sus metadatos, y usan la
                  misma paleta oscura del detalle. Todo son casillas —incluida
                  `tradition`, que es jerarquía de un nivel, no un árbol de
                  selección única—. Sin vocabulario no hay bloque: no se pinta un
                  «Tags» vacío.
                */}
                <Show when={tagGroups()}>
                  {(groups) => (
                    <section class="space-y-3 rounded border border-gray-700 bg-gray-800/40 p-4">
                      <h3 class="text-xs uppercase tracking-wide text-gray-500">Tags</h3>

                      <Show when={loadingTags()}>
                        <p class="text-sm text-gray-400">Loading…</p>
                      </Show>

                      <Show when={tagError()}>
                        <p class="text-sm text-red-400" role="alert">
                          {tagError()}
                        </p>
                      </Show>

                      <div class="space-y-3">
                        <For each={groups()}>
                          {(group) => (
                            <fieldset class="space-y-1">
                              <legend class="text-xs text-gray-400">{group.facet.label}</legend>
                              <For each={group.nodes}>
                                {(node) => (
                                  <>
                                    {tagBox(node.tag, group.facet)}
                                    <For each={node.children}>
                                      {(child) => tagBox(child, group.facet, true)}
                                    </For>
                                  </>
                                )}
                              </For>
                            </fieldset>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>

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
