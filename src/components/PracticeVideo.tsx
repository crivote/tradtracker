import { Show, createMemo, createSignal } from 'solid-js';
import { embedUrl, thumbnailUrl, type TuneSegment } from '../lib/tradtube';
import './practice-video.css';

/**
 * El vídeo de TradTube de una fila de la lista de ensayo (#37).
 *
 * Tres reglas del diseño mandan sobre lo demás:
 *   · **Nada suena al abrir la página.** Se pinta un botón con la miniatura; el
 *     `autoplay` del iframe solo aparece cuando el usuario pulsa, porque ese
 *     clic es la petición.
 *   · **Sin segmentos no hay hueco.** Ni borde, ni mensaje, ni marcador: la fila
 *     de la lista se lee igual que una tune sin vídeo.
 *   · **Una tune, un botón.** Con varios segmentos se abre el primero
 *     disponible; no hay control para cambiar de segmento (el título del botón
 *     sí dice cuántos hay).
 *
 * Se pinta sobre papel, dentro de `.practice`: las variables (`--paper`,
 * `--ink`, `--muted`, `--line`, `--accent`) vienen de `repertoire.css` y aquí no
 * se redeclaran ni se usan utilidades Tailwind oscuras.
 */

/** `m:ss` de la duración del segmento; nada si el segmento no declara fin. */
function durationLabel(segment: TuneSegment): string | null {
  if (segment.endSec === null || segment.endSec === undefined) return null;
  const seconds = Math.max(0, Math.round(segment.endSec - segment.startSec));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** «1 segment» / «3 segments». */
function segmentsLabel(count: number): string {
  return `${count} segment${count === 1 ? '' : 's'}`;
}

export function PracticeVideo(props: { segments: readonly TuneSegment[] }) {
  const [open, setOpen] = createSignal(false);

  /**
   * Se abre el primer segmento **disponible**: una entrada caída no debe tapar
   * otra que sí se puede ver. Si no hay ninguna, queda la primera y el botón
   * sale deshabilitado y marcado `unavailable` (aquí las caídas se enseñan, a
   * diferencia del frontal de TradTube).
   */
  const target = createMemo<TuneSegment | null>(
    () => props.segments.find((segment) => !segment.unavailable) ?? props.segments[0] ?? null
  );

  /** «disponibles» = las que no están marcadas como caídas. */
  const availableCount = createMemo(
    () => props.segments.filter((segment) => !segment.unavailable).length
  );

  return (
    <Show when={target()}>
      {(segment) => {
        const unavailable = () => segment().unavailable;
        const duration = () => durationLabel(segment());
        const heading = () =>
          `${segment().title ?? 'TradTube video'} · ${segmentsLabel(availableCount())}`;

        return (
          <div class="practice-video">
            <button
              type="button"
              class="practice-video__toggle"
              classList={{ 'is-open': open(), 'is-unavailable': unavailable() }}
              disabled={unavailable()}
              aria-expanded={open()}
              title={heading()}
              onClick={() => setOpen((previous) => !previous)}
            >
              <Show
                when={!unavailable()}
                fallback={<span class="practice-video__flag">unavailable</span>}
              >
                <img
                  class="practice-video__thumb"
                  src={thumbnailUrl(segment().youtubeId)}
                  alt=""
                  width="320"
                  height="180"
                  loading="lazy"
                />
                <span class="practice-video__bar">
                  <Show when={duration()}>
                    {(label) => <span class="practice-video__time">{label()}</span>}
                  </Show>
                  <span class="practice-video__hint">{open() ? 'Hide video' : 'Play video'}</span>
                </span>
              </Show>
            </button>

            <Show when={open() && !unavailable()}>
              <div class="practice-video__frame">
                <iframe
                  src={`${embedUrl(segment())}&autoplay=1`}
                  title={segment().title ?? 'TradTube video'}
                  allow="autoplay; encrypted-media"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen
                />
              </div>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
