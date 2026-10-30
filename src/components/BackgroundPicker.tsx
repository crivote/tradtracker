import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import {
  CANDIDATE_COUNT,
  ZOOM_MAX,
  ZOOM_MIN,
  cropGeometry,
  focalAfterDrag,
  focalPosition,
  isFreeLicense,
  isShareAlike,
  licenseLabel,
  ratioTag,
  searchWords,
  type ImageCandidate,
  type ImageRegister,
  type SearchSource,
} from '../lib/image-sources';
import { ImageSearchError, enlargeCommons, searchCandidates } from '../lib/image-search';
import { clearImageChoice, saveImageChoice } from '../lib/repertoire';
import { imageCredit, type ChosenImage } from '../lib/repertoire-model';

/**
 * Selector de fondo del tune (issue #31): nueve candidatos en mosaico 3×3, cada
 * tile en la proporción 5:4 de la carta, con su licencia (verde si no obliga a
 * nada) y la etiqueta `vertical`/`panoramic` cuando el ratio se aleja del 5:4.
 *
 * La interacción viene del prototipo `010-selector-seis`, que es la referencia de
 * comportamiento: aquí se reescribe con el build del repo (TSX + Tailwind) y la
 * persistencia va a Supabase, no a `localStorage`.
 *
 * Lo que se guarda en el navegador es **solo la clave de Pexels** (`tt-pexels-key`):
 * no hay secreto compartido ni función de servidor.
 */

/** Clave de `localStorage` de la clave de Pexels. Vive en el navegador del usuario. */
export const PEXELS_KEY_STORAGE = 'tt-pexels-key';

function readStoredKey(): string {
  try {
    return localStorage.getItem(PEXELS_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function writeStoredKey(value: string): void {
  try {
    localStorage.setItem(PEXELS_KEY_STORAGE, value);
  } catch {
    /* modo privado o almacenamiento bloqueado: la clave dura lo que la página */
  }
}

type Notice = 'missing-key' | 'rejected' | null;

export interface BackgroundPickerProps {
  /** uuid de la fila de repertorio: el ancla personal del fondo. */
  repertoireId: string;
  /** Título mostrado, para prerrellenar las palabras. */
  title: string;
  /** Fondo guardado, si lo hay. */
  image: ChosenImage | null;
  /** Recarga la fila tras guardar o quitar el fondo. */
  onSaved: () => void | Promise<void>;
}

export default function BackgroundPicker(props: BackgroundPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [keywords, setKeywords] = createSignal(searchWords(props.title));
  const [source, setSource] = createSignal<SearchSource>('commons');
  const [register, setRegister] = createSignal<ImageRegister>('both');

  const [candidates, setCandidates] = createSignal<ImageCandidate[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const [storedKey, setStoredKey] = createSignal(readStoredKey());
  const [keyDraft, setKeyDraft] = createSignal('');

  // Estado del fondo en pantalla: empieza en lo guardado y lo mueve el encuadre.
  const [chosen, setChosen] = createSignal<ChosenImage | null>(props.image);
  const [focalX, setFocalX] = createSignal(props.image?.focalX ?? 50);
  const [focalY, setFocalY] = createSignal(props.image?.focalY ?? 50);
  const [zoom, setZoom] = createSignal(props.image?.zoom ?? 1);

  // Caja del recuadro en píxeles de layout: la matemática del encuadre la necesita.
  const [boxWidth, setBoxWidth] = createSignal(0);
  const [boxHeight, setBoxHeight] = createSignal(0);
  let cropBox: HTMLDivElement | undefined;

  /** Arrastre en curso: punto de partida y desborde con el que se calcula. */
  const [drag, setDrag] = createSignal<{
    startX: number;
    startY: number;
    focalX: number;
    focalY: number;
    overflowX: number;
    overflowY: number;
  } | null>(null);

  createEffect(() => {
    // La fila se recarga tras guardar: lo guardado manda, y el encuadre local se
    // sincroniza con ella para que recargar la página dé exactamente esto.
    const image = props.image;
    setChosen(image);
    setFocalX(image?.focalX ?? 50);
    setFocalY(image?.focalY ?? 50);
    setZoom(image?.zoom ?? 1);
  });

  /**
   * Otra tune en la misma instancia del componente: palabras nuevas y mosaico
   * limpio. Se compara el título de verdad porque el detalle recarga la fila
   * tras guardar (y `props.title` es un getter que se reevalúa): sin esta
   * guarda, guardar el fondo borraba el mosaico y el encuadre se quedaba sin
   * medidas.
   */
  let lastTitle: string | undefined;
  createEffect(() => {
    const title = props.title;
    if (lastTitle === title) return;
    lastTitle = title;
    setKeywords(searchWords(title));
    setCandidates([]);
    setSearched(false);
    setNotice(null);
    setError(null);
  });

  /**
   * Medidas de la imagen elegida. La fila guarda las URLs, no el ancho ni el
   * alto, así que si el candidato no está en el mosaico de esta sesión (al
   * recargar la página) se mide la imagen de verdad: sin medidas no hay
   * desborde que arrastrar y el encuadre no se podría tocar.
   */
  const [naturalSize, setNaturalSize] = createSignal<{ width: number; height: number } | null>(null);
  const [imageBroken, setImageBroken] = createSignal(false);

  createEffect(() => {
    const current = chosen();
    setImageBroken(false);
    if (!current) {
      setNaturalSize(null);
      return;
    }

    const match = candidates().find(
      (candidate) => candidate.source === current.source && candidate.id === current.id
    );
    if (match && match.width > 0 && match.height > 0) {
      setNaturalSize({ width: match.width, height: match.height });
      return;
    }

    const url = current.fullUrl ?? current.thumbUrl;
    if (!url) {
      setNaturalSize(null);
      return;
    }

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      setNaturalSize({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      // Rama del no: la imagen ya no está en origen (404 del CDN).
      if (!cancelled) setImageBroken(true);
    };
    probe.src = url;
    onCleanup(() => {
      cancelled = true;
    });
  });

  const imageWidth = () => naturalSize()?.width ?? 0;
  const imageHeight = () => naturalSize()?.height ?? 0;

  const measure = () => {
    const node = cropBox;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setBoxWidth(rect.width);
    setBoxHeight(rect.height);
  };

  const runSearch = async () => {
    const words = keywords().trim();
    if (words.length === 0) return;

    setSearching(true);
    setSearched(false);
    setError(null);
    setNotice(null);
    setCandidates([]);

    try {
      const found = await searchCandidates({
        words,
        source: source(),
        register: register(),
        pexelsKey: storedKey(),
      });
      setCandidates(found.slice(0, CANDIDATE_COUNT));
      setSearched(true);
    } catch (cause) {
      setCandidates([]);
      setSearched(true);
      if (cause instanceof ImageSearchError && cause.kind === 'missing-key') {
        // Sin clave no es un error de red: es un aviso con su campo.
        setNotice('missing-key');
      } else if (cause instanceof ImageSearchError && cause.kind === 'rejected') {
        setNotice('rejected');
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setSearching(false);
    }
  };

  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next) void runSearch();
  };

  const chooseSource = (next: SearchSource) => {
    setSource(next);
    if (next === 'pexels' && storedKey().length === 0) {
      setNotice('missing-key');
      return;
    }
    void runSearch();
  };

  const chooseRegister = (next: ImageRegister) => {
    setRegister(next);
    if (source() === 'commons') void runSearch();
  };

  const saveKeyAndSearch = () => {
    const value = keyDraft().trim();
    if (value.length === 0) return;
    writeStoredKey(value);
    setStoredKey(value);
    setKeyDraft('');
    void runSearch();
  };

  /** Elige un candidato: pide el grande y guarda la fila con el encuadre centrado. */
  const choose = async (candidate: ImageCandidate) => {
    setSaving(true);
    setError(null);
    try {
      // Commons: una sola petición a 960, y solo ahora. Se guarda el thumburl que
      // devuelve el API — nunca una ruta compuesta a mano.
      const fullUrl =
        candidate.source === 'commons' ? await enlargeCommons(candidate) : candidate.fullUrl;

      await saveImageChoice(props.repertoireId, {
        source: candidate.source,
        id: candidate.id,
        thumbUrl: candidate.thumbUrl,
        fullUrl,
        pageUrl: candidate.pageUrl,
        author: candidate.author,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl,
        focalX: 50,
        focalY: 50,
        zoom: 1,
      });

      setChosen({
        source: candidate.source,
        id: candidate.id,
        thumbUrl: candidate.thumbUrl,
        fullUrl,
        pageUrl: candidate.pageUrl,
        author: candidate.author,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl,
        focalX: 50,
        focalY: 50,
        zoom: 1,
        chosenAt: new Date().toISOString(),
      });
      setFocalX(50);
      setFocalY(50);
      setZoom(1);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** Persiste el encuadre actual (al soltar el arrastre y al cambiar el zoom). */
  const persistCrop = async () => {
    const current = chosen();
    if (!current || current.source === 'upload') return;
    const next = {
      focalX: Math.round(focalX()),
      focalY: Math.round(focalY()),
      zoom: zoom(),
    };
    try {
      await saveImageChoice(props.repertoireId, {
        source: current.source,
        id: current.id ?? '',
        thumbUrl: current.thumbUrl ?? '',
        fullUrl: current.fullUrl ?? current.thumbUrl ?? '',
        pageUrl: current.pageUrl ?? '',
        author: current.author ?? '',
        license: current.license ?? '',
        licenseUrl: current.licenseUrl,
        ...next,
      });
      setChosen({ ...current, ...next });
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const clear = async () => {
    setSaving(true);
    setError(null);
    try {
      await clearImageChoice(props.repertoireId);
      setChosen(null);
      await props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const startDrag = (event: PointerEvent) => {
    const current = chosen();
    if (!current || !current.fullUrl) return;
    // El desborde se calcula con la caja medida y las medidas del candidato.
    const measured = cropGeometry({
      boxWidth: boxWidth(),
      boxHeight: boxHeight(),
      imageWidth: imageWidth(),
      imageHeight: imageHeight(),
      zoom: zoom(),
      focalX: focalX(),
      focalY: focalY(),
    });

    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      focalX: focalX(),
      focalY: focalY(),
      overflowX: measured.overflowX,
      overflowY: measured.overflowY,
    });
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* sin captura el arrastre sigue con los eventos del documento */
    }
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent) => {
    const active = drag();
    if (!active) return;
    const next = focalAfterDrag(
      { x: active.focalX, y: active.focalY },
      event.clientX - active.startX,
      event.clientY - active.startY,
      { overflowX: active.overflowX, overflowY: active.overflowY }
    );
    if (active.overflowX > 0) setFocalX(next.x);
    if (active.overflowY > 0) setFocalY(next.y);
  };

  const endDrag = () => {
    if (!drag()) return;
    setDrag(null);
    void persistCrop();
  };

  const tileStyle = (candidate: ImageCandidate) => ({
    'object-position': focalPosition(focalX(), focalY()),
  });

  const cropStyle = () => {
    const current = chosen();
    if (!current) return {};
    const geometry = cropGeometry({
      boxWidth: boxWidth(),
      boxHeight: boxHeight(),
      imageWidth: imageWidth(),
      imageHeight: imageHeight(),
      zoom: zoom(),
      focalX: focalX(),
      focalY: focalY(),
    });
    return {
      'background-image': `url("${current.fullUrl ?? current.thumbUrl ?? ''}")`,
      'background-size': geometry.backgroundSize,
      'background-position': geometry.backgroundPosition,
      'background-repeat': 'no-repeat',
    };
  };

  return (
    <section class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:border-amber-500 hover:text-amber-300"
          aria-expanded={open()}
          onClick={toggle}
        >
          {open() ? 'Close background picker' : 'Choose background'}
        </button>
        <Show when={chosen()}>
          {(image) => (
            <p class="text-xs text-gray-400">
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
            </p>
          )}
        </Show>
      </div>

      <Show when={open()}>
        <div class="space-y-4 rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div class="flex flex-wrap items-end gap-3">
            <label class="min-w-0 flex-1 text-sm text-gray-400" for="background-words">
              Words
              <input
                id="background-words"
                type="text"
                autocomplete="off"
                spellcheck={false}
                value={keywords()}
                onInput={(event) => setKeywords(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void runSearch();
                  }
                }}
                class="mt-1 w-full rounded border border-gray-600 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              class="rounded bg-amber-500 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
              onClick={() => void runSearch()}
            >
              Search
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-4 text-xs text-gray-400">
            <div class="flex overflow-hidden rounded border border-gray-600" role="group" aria-label="Image source">
              <button
                type="button"
                class={`px-3 py-1.5 ${source() === 'commons' ? 'bg-amber-500 text-gray-900' : 'hover:text-amber-300'}`}
                aria-pressed={source() === 'commons'}
                onClick={() => chooseSource('commons')}
              >
                Wikimedia
              </button>
              <button
                type="button"
                class={`px-3 py-1.5 ${source() === 'pexels' ? 'bg-amber-500 text-gray-900' : 'hover:text-amber-300'}`}
                aria-pressed={source() === 'pexels'}
                onClick={() => chooseSource('pexels')}
              >
                Pexels
              </button>
            </div>

            <div class="flex overflow-hidden rounded border border-gray-600" role="group" aria-label="Image register">
              <For each={['both', 'art', 'photo'] as ImageRegister[]}>
                {(option) => (
                  <button
                    type="button"
                    class={`px-3 py-1.5 ${register() === option ? 'bg-amber-500 text-gray-900' : 'hover:text-amber-300'}`}
                    aria-pressed={register() === option}
                    onClick={() => chooseRegister(option)}
                  >
                    {option === 'both' ? 'Both' : option === 'art' ? 'Art' : 'Photo'}
                  </button>
                )}
              </For>
            </div>

            <Show when={source() === 'pexels'}>
              <label class="flex items-center gap-2" for="pexels-key">
                Pexels key
                <input
                  id="pexels-key"
                  type="password"
                  autocomplete="off"
                  placeholder="paste your key"
                  value={keyDraft()}
                  onInput={(event) => setKeyDraft(event.currentTarget.value)}
                  class="w-48 rounded border border-gray-600 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="button"
                  class="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:border-amber-500 hover:text-amber-300"
                  onClick={saveKeyAndSearch}
                >
                  Save key
                </button>
              </label>
            </Show>
          </div>

          <Show when={error()}>
            <p class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200" role="alert">
              {error()}
            </p>
          </Show>

          <Show when={notice() === 'missing-key'}>
            <p class="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
              Pexels needs your API key. Paste it above and press “Save key” — it stays in this
              browser and is never stored in the database. Wikimedia keeps working without it.
            </p>
          </Show>

          <Show when={notice() === 'rejected'}>
            <p class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200" role="alert">
              Pexels rejected that key. Check it and paste it again — this is not the same as having
              no key.
            </p>
          </Show>

          <div class="grid grid-cols-3 gap-2.5" aria-label="Background candidates">
            <Show
              when={!searching()}
              fallback={
                <For each={Array.from({ length: CANDIDATE_COUNT })}>
                  {() => <div class="aspect-[5/4] animate-pulse rounded border border-gray-700 bg-gray-800" />}
                </For>
              }
            >
              <For each={candidates()}>
                {(candidate) => (
                  <button
                    type="button"
                    class="relative aspect-[5/4] overflow-hidden rounded border border-gray-700 bg-gray-800 hover:border-amber-500"
                    title={`${candidate.author} · ${candidate.title}`}
                    onClick={() => void choose(candidate)}
                  >
                    <img
                      src={candidate.thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      class="h-full w-full object-cover"
                      style={tileStyle(candidate)}
                    />
                    <Show when={ratioTag(candidate)}>
                      {(tag) => (
                        <span class="absolute bottom-1.5 left-1.5 rounded bg-gray-950/85 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                          {tag()}
                        </span>
                      )}
                    </Show>
                    <span
                      class={`absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] ${
                        isFreeLicense(candidate.license)
                          ? 'bg-emerald-700/90 text-emerald-50'
                          : 'bg-gray-950/85 text-gray-300'
                      }`}
                      title={candidate.license}
                    >
                      {licenseLabel(candidate.license)}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>

          <Show when={searched() && !searching() && candidates().length === 0 && !error() && !notice()}>
            <div class="rounded border border-dashed border-gray-700 bg-gray-800/50 px-4 py-6 text-center text-sm text-gray-300">
              <p class="font-medium text-gray-200">No reference for those words.</p>
              <p class="mt-1 text-gray-400">
                Nothing came back — not a painting, not an object, not a file with that name. Try a
                single word: a place, an object, a trade.
              </p>
            </div>
          </Show>

          <Show when={candidates().length > 0 && !searching()}>
            <p class="text-xs text-gray-500">
              {candidates().length} of {CANDIDATE_COUNT} candidates · green licence = public domain,
              CC0 or Pexels · thumbnails at 330 px
            </p>
          </Show>

          <Show when={chosen()}>
            {(image) => (
              <div class="grid gap-4 border-t border-gray-800 pt-4 sm:grid-cols-[248px_1fr]">
                <div
                  ref={(node) => {
                    cropBox = node;
                    // La caja se mide al montar y al cambiar de tamaño: la
                    // geometría del encuadre va en píxeles, no en porcentajes.
                    queueMicrotask(measure);
                    if (typeof ResizeObserver !== 'undefined') {
                      const observer = new ResizeObserver(() => measure());
                      observer.observe(node);
                    }
                  }}
                  class="relative aspect-[5/4] cursor-grab touch-none overflow-hidden rounded border border-gray-600 bg-gray-800 select-none"
                  title="Drag to frame"
                  style={cropStyle()}
                  onPointerDown={startDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />

                <div class="space-y-3 text-sm text-gray-300">
                  <Show when={imageBroken()}>
                    <p class="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
                      That image is gone from its source. Pick another one — the card stays without
                      a background until you do.
                    </p>
                  </Show>
                  <p class="font-medium text-gray-100">
                    Chosen
                    <Show when={ratioTag({ width: imageWidth(), height: imageHeight() })}>
                      {(tag) => (
                        <span class="ml-2 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                          {tag()}
                        </span>
                      )}
                    </Show>
                  </p>
                  <p class="break-words text-xs text-gray-400">
                    {imageCredit(image())}
                    <Show when={image().licenseUrl}>
                      {' · '}
                      <a
                        href={image().licenseUrl!}
                        target="_blank"
                        rel="noreferrer"
                        class="text-amber-300 hover:text-amber-200"
                      >
                        licence
                      </a>
                    </Show>
                    <Show when={image().pageUrl}>
                      {' · '}
                      <a
                        href={image().pageUrl!}
                        target="_blank"
                        rel="noreferrer"
                        class="text-amber-300 hover:text-amber-200"
                      >
                        view original
                      </a>
                    </Show>
                  </p>
                  <Show when={image().license && isShareAlike(image().license!)}>
                    <p class="text-xs text-amber-300/90">
                      Share-alike: cropping this image makes a derivative work.
                    </p>
                  </Show>

                  <label class="flex items-center gap-3 text-xs text-gray-400" for="background-zoom">
                    Zoom
                    <input
                      id="background-zoom"
                      type="range"
                      min={Math.round(ZOOM_MIN * 100)}
                      max={Math.round(ZOOM_MAX * 100)}
                      step="5"
                      value={Math.round(zoom() * 100)}
                      onInput={(event) => setZoom(Number(event.currentTarget.value) / 100)}
                      onChange={() => void persistCrop()}
                      class="w-40 accent-amber-500"
                    />
                    <b class="tabular-nums text-gray-300">{Math.round(zoom() * 100)}%</b>
                  </label>

                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-amber-500 hover:text-amber-300"
                      onClick={() => {
                        setFocalX(50);
                        setFocalY(50);
                        setZoom(1);
                        void persistCrop();
                      }}
                    >
                      Centre
                    </button>
                    <button
                      type="button"
                      disabled={saving()}
                      class="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-red-500 hover:text-red-300 disabled:opacity-60"
                      onClick={() => void clear()}
                    >
                      Remove background
                    </button>
                    <span class="text-xs text-gray-500">
                      focal {Math.round(focalX())}% · {Math.round(focalY())}%
                    </span>
                  </div>
                  <p class="text-xs text-gray-500">
                    Drag the box to move the crop; the frame is 5:4, like the card. Only the axis
                    that overflows moves.
                  </p>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
