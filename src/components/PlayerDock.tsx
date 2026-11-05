import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { hasVideoControl, pickSegment } from '../lib/player-model';
import { TEMPO_STEP } from '../lib/abc-player';
import { fallbackEmbedUrl, mountVideoPlayer, type VideoPlayerHandle } from '../lib/video-player';
import type { TuneSegment } from '../lib/tradtube';
import {
  attachVideo,
  canShiftVideoRate,
  close,
  closeVideo,
  currentInstrumentLabel,
  currentPlayable,
  currentSegments,
  currentStatus,
  currentTempo,
  currentTitle,
  currentVideoRateLabel,
  cycleInstrument,
  detachVideo,
  dockState,
  isLooping,
  isPanelOpen,
  isScoreOpen,
  isVideoOpen,
  isVideoUncontrolled,
  metaLine,
  openVideo,
  paintScore,
  panelLabel,
  play,
  playLabel,
  reserve,
  setSink,
  shiftTempo,
  shiftVideoRate,
  toggleLoop,
  togglePanel,
  toggleScore,
  videoFailed,
  videoRateChanged,
  videoStateChanged,
  videoUncontrolled,
} from '../lib/player-store';
import './player-dock.css';

/**
 * El vídeo del dock (#53): el reproductor de YouTube **y su barra de velocidad**.
 *
 * El `<div>` de `ref` es el nodo que YouTube sustituye por su iframe. El player
 * se destruye al desmontar —sale del DOM con su sonido— y el store deja de
 * gobernarlo. Si la IFrame API no carga, se pinta el iframe plano de siempre y
 * el dock lo dice con el ▶ deshabilitado: se degrada a lo que había, pero no se
 * finge un control que no existe.
 *
 * La velocidad vive **aquí dentro** y no en la bandeja porque con el vídeo
 * abierto la bandeja no se pinta: un control escondido no es un control.
 */
function VideoPanel(props: { segment: TuneSegment }) {
  let host!: HTMLDivElement;
  let handle: VideoPlayerHandle | null = null;

  onMount(() => {
    let alive = true;

    void mountVideoPlayer({
      host,
      segment: props.segment,
      onState: (event) => {
        if (alive) videoStateChanged(event);
      },
      onRate: (rate) => {
        if (alive) videoRateChanged(rate);
      },
      onError: () => {
        if (alive) videoFailed();
      },
    })
      .then((mounted) => {
        // Se cerró el vídeo mientras la API cargaba: el player no debe quedar vivo.
        if (!alive) {
          mounted.handle.destroy();
          return;
        }
        handle = mounted.handle;
        attachVideo(mounted.handle, mounted.rates);
      })
      .catch(() => {
        if (alive) videoUncontrolled();
      });

    onCleanup(() => {
      alive = false;
      handle?.destroy();
      handle = null;
      detachVideo();
    });
  });

  return (
    <div class="player-dock__video" classList={{ 'is-collapsed': !isPanelOpen() }}>
      <div class="player-dock__frame">
        <div class="player-dock__frame-host" ref={host} />
        <Show when={isVideoUncontrolled()}>
          <iframe
            src={fallbackEmbedUrl(props.segment)}
            title={props.segment.title ?? 'TradTube video'}
            allow="autoplay; encrypted-media"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          />
        </Show>
        {/* El ✕ va dentro del marco: con el vídeo más estrecho que el dock, en el
            borde del dock flotaría lejos de la esquina del reproductor. */}
        <button
          type="button"
          class="player-dock__video-close"
          aria-label="Close video"
          onClick={closeVideo}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* Sin player no hay velocidad que cambiar: la barra no se pinta. */}
      <Show when={!isVideoUncontrolled()}>
        <div class="player-dock__speed" role="group" aria-label="Video speed">
          <span class="player-dock__speed-caption">Speed</span>
          <button
            type="button"
            class="player-dock__step"
            aria-label="Slower video"
            disabled={!canShiftVideoRate(-1)}
            onClick={() => shiftVideoRate(-1)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <output class="player-dock__speed-value" aria-live="polite">
            {currentVideoRateLabel()}
          </output>
          <button
            type="button"
            class="player-dock__step"
            aria-label="Faster video"
            disabled={!canShiftVideoRate(1)}
            onClick={() => shiftVideoRate(1)}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </Show>
    </div>
  );
}

/**
 * El reproductor flotante (#49): **uno solo, para toda la app**.
 *
 * Se monta en el layout, no en las vistas. La música sobrevive a la navegación
 * porque el motor vive en un módulo (`player-engine.ts`) y este componente no
 * se desmonta al cambiar de ruta.
 *
 * Lo que este componente **no** hace, y es deliberado:
 *   · **No suena al montarse.** Nada se pide y nada se dibuja hasta el primer ▶.
 *   · **No oculta el vídeo con `display:none`.** Cerrar el vídeo o el dock saca
 *     el `<iframe>` del DOM: un iframe oculto sigue sonando, y ese es el fallo
 *     que la issue pide no repetir.
 *   · **No pinta una barra de progreso.** El sintetizador de `abcjs` no expone
 *     el instante actual; hasta derivarlo, se enseña la duración, no una barra
 *     que miente.
 *
 * La identidad es la del boceto 017: verde profundo, ocre vivo solo en el ▶, y
 * el ✕ y el chevron en gris verdoso para no competir con él.
 */
export function PlayerDock() {
  let sink!: HTMLDivElement;
  const [dockHeight, setDockHeight] = createSignal(0);

  onMount(() => setSink(sink));
  onCleanup(() => setSink(null));

  /**
   * La altura real del dock, medida. Las cifras del diseño (56 / 143 px) valen
   * para la barra y la bandeja, pero la partitura y el vídeo crecen por su
   * cuenta: con la partitura abierta el dock pasa de 300 px y el relleno fijo de
   * 190 dejaría el final del contenido debajo. Se reserva `max(diseño, medido)`
   * y así la promesa «nunca tapa el final» se cumple también ahí.
   *
   * El observador se ata **al nodo**, no al montaje del componente: el dock vive
   * dentro de un `Show` y en el primer render no existe.
   */
  let observer: ResizeObserver | null = null;
  const attachDock = (element: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return;
    observer?.disconnect();
    observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      setDockHeight(Math.round(height));
    });
    observer.observe(element);
  };
  onCleanup(() => observer?.disconnect());

  /**
   * `Esc` cierra el dock entero, también con el vídeo abierto: el ✕ del marco
   * cierra solo el vídeo, pero la tecla es la salida de emergencia y no debe
   * dejar nada sonando. El escuchante vive solo mientras el dock está abierto.
   */
  createEffect(() => {
    if (dockState() === 'closed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  /**
   * El relleno del cuerpo, dinámico: con la bandeja abierta el dock mide casi el
   * triple y la última carta quedaría debajo. Cerrado no reserva nada.
   *
   * Las tres pantallas de papel ya traen sus propios 90 px de fondo, así que
   * allí solo se añade lo que falta para la bandeja: sumar los 190 enteros
   * dejaría una banda del color del armazón bajo el papel.
   */
  createEffect(() => {
    const measured = dockHeight();
    // 16 px del borde inferior del dock + 16 px de aire bajo la última línea.
    const space = Math.max(reserve(), measured > 0 ? measured + 32 : 0);
    const root = document.documentElement;
    root.style.setProperty('--dock-space', `${space}px`);
    root.style.setProperty('--dock-space-paper', `${Math.max(0, space - 90)}px`);
  });

  const segment = () => pickSegment(currentSegments());

  return (
    <>
      {/*
        El blanco de `renderAbc` para el audio: el sintetizador necesita un
        `TuneObject` y el único modo de obtenerlo es dibujar. Va fuera de la
        vista, pero no con `display:none` —el engraver mide texto— y sin coste
        de lectura. Siempre montado: el motor puede estar sonando mientras el
        dock se repinta.
      */}
      <div class="player-sink" aria-hidden="true" ref={sink} />

      <Show when={dockState() !== 'closed'}>
        <section
          class="player-dock"
          aria-label="Player"
          classList={{ 'is-panel': isPanelOpen() }}
          ref={attachDock}
        >
          <div class="player-dock__bar">
            <button
              type="button"
              class="player-dock__play"
              aria-label={playLabel()}
              aria-pressed={dockState() === 'playing' ? 'true' : 'false'}
              disabled={!currentPlayable()}
              onClick={() => void play()}
            >
              <span aria-hidden="true">{dockState() === 'playing' ? '❚❚' : '▶'}</span>
            </button>

            <div class="player-dock__id">
              <p class="player-dock__title" title={currentTitle()}>
                {currentTitle()}
              </p>
              <p class="player-dock__meta">
                <Show when={currentStatus()} fallback={metaLine().join(' · ')}>
                  {(text) => <span class="player-dock__status">{text()}</span>}
                </Show>
              </p>
            </div>

            <button
              type="button"
              class="player-dock__chevron"
              aria-label={panelLabel()}
              aria-expanded={isPanelOpen() ? 'true' : 'false'}
              onClick={togglePanel}
            >
              <span aria-hidden="true">{isPanelOpen() ? '⌃' : '⌄'}</span>
            </button>

            <button
              type="button"
              class="player-dock__close"
              aria-label="Close player"
              onClick={close}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <Show when={isPanelOpen() && !isVideoOpen()}>
            <div class="player-dock__tray">
              <div class="player-dock__tempo" role="group" aria-label="Tempo">
                <button
                  type="button"
                  class="player-dock__step"
                  aria-label="Slower"
                  onClick={() => shiftTempo(-TEMPO_STEP)}
                >
                  −
                </button>
                <span class="player-dock__bpm" aria-label="Beats per minute">
                  {currentTempo()}
                </span>
                <button
                  type="button"
                  class="player-dock__step"
                  aria-label="Faster"
                  onClick={() => shiftTempo(TEMPO_STEP)}
                >
                  +
                </button>
              </div>

              <button
                type="button"
                class="player-dock__toggle"
                aria-label="Loop"
                aria-pressed={isLooping() ? 'true' : 'false'}
                onClick={toggleLoop}
              >
                <span aria-hidden="true">⟳</span> Loop
              </button>

              <button
                type="button"
                class="player-dock__toggle"
                aria-label={`Instrument: ${currentInstrumentLabel()}`}
                onClick={cycleInstrument}
              >
                {currentInstrumentLabel()}
              </button>

              <button
                type="button"
                class="player-dock__toggle"
                aria-label={isScoreOpen() ? 'Hide score' : 'Show score'}
                aria-expanded={isScoreOpen() ? 'true' : 'false'}
                onClick={toggleScore}
              >
                Score
              </button>

              {/*
                Sin segmento de TradTube, el control **no existe**: no se pinta
                deshabilitado. Con segmento pero caído, sí se pinta y se
                deshabilita, porque ahí sí hay algo que el usuario debe saber.
              */}
              <Show when={hasVideoControl(currentSegments())}>
                <button
                  type="button"
                  class="player-dock__toggle"
                  aria-label={isVideoOpen() ? 'Hide video' : 'Play video'}
                  aria-expanded={isVideoOpen() ? 'true' : 'false'}
                  disabled={Boolean(segment()?.unavailable)}
                  onClick={() => (isVideoOpen() ? closeVideo() : openVideo())}
                >
                  Video
                </button>
              </Show>
            </div>
          </Show>

          {/*
            El vídeo sustituye a la bandeja y vive mientras se pide. Su ✕ cierra
            el vídeo, no el dock — y desmonta el iframe de verdad.
          */}
          <Show when={isVideoOpen() ? segment() : null} keyed>
            {(current) => <VideoPanel segment={current} />}
          </Show>

          <Show when={isScoreOpen()}>
            {/*
              `abcjs` escribe estilos **en el padre** del nodo donde dibuja
              (`display:inline-block` y un `padding-bottom` con la proporción de
              la partitura). Si dibujara sobre el contenedor que scrollea, le
              impondría esa altura y el dock crecería hasta sacar la barra de la
              pantalla —medido: 987 px de partitura en una ventana de 437—. De
              ahí el envoltorio interior: el de fuera manda en el scroll, el de
              dentro es de `abcjs`.
            */}
            <div class="player-dock__score">
              <div
                class="player-dock__score-inner"
                ref={(element) => {
                  // Se dibuja al desplegar, nunca antes. `isConnected` evita
                  // pintar en un nodo que se fue mientras cargaba `abcjs`.
                  void paintScore(element).then(() => {
                    if (!element.isConnected) element.replaceChildren();
                  });
                }}
              />
            </div>
          </Show>
        </section>
      </Show>
    </>
  );
}

export default PlayerDock;
