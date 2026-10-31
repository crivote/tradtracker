import { Show, createSignal, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import type { MidiBuffer } from 'abcjs';
import { abcFromRow, resolveAbc } from '../lib/abc-source';
import {
  LOOP_GAP_MS,
  SOUNDFONT_URL,
  TEMPO_STEP,
  clampTempo,
  tempoFor,
} from '../lib/abc-player';
import {
  DEFAULT_PREFS,
  INSTRUMENTS,
  readPrefs,
  writePrefs,
  type KeyValueStore,
  type PracticeInstrument,
} from '../lib/practice-storage';
import { displayTitle, type RepertoireRow } from '../lib/repertoire-model';
import './practice-player.css';

/**
 * Reproductor ABC mínimo de una fila de la lista de ensayo (#38).
 *
 * Una barra de una línea —`▶ · tempo −/+ · ⟳ loop · instrumento · [score]`— y
 * el sintetizador de `abcjs` detrás, con **samples propios** servidos desde
 * `/soundfonts/` para que la fila suene sin pedirle nada a un CDN de terceros.
 *
 * Cinco decisiones mandan sobre el resto:
 *   · **Nada de red al montar.** Ocho filas son ocho peticiones si se resuelve
 *     al montar, y la mayoría de las tunes ya traen su ABC en la fila. El ABC se
 *     resuelve en el primer ▶ (o al desplegar la partitura), y solo entonces.
 *   · **`abcjs` entra por `import()` dinámico.** El paquete pesa ~500 KB
 *     minificado: no puede caer en el bundle de la home por una barra.
 *   · **El tempo va al sintetizador al montarlo.** En el paquete instalado nadie
 *     lee `qpm` al dibujar; quien fija la duración es `CreateSynth().init()` a
 *     través de `options.qpm` (ver el comentario de `startEngine`). Cambiar de
 *     tempo es volver a montar el motor con el `qpm` nuevo: se oye.
 *   · **El loop se para de verdad.** El reinicio va con un `setTimeout`, y el
 *     botón de parar **cancela el temporizador pendiente**: sin eso el loop
 *     vuelve a sonar un segundo después de haberlo parado, que es el fallo
 *     clásico.
 *   · **Sin ABC nunca se enseña un error crudo.** La barra dice `no ABC` y el ▶
 *     se deshabilita. Sin WebAudio dice `audio unavailable` y la fila sigue.
 *
 * Lo que aquí no se puede probar —el sonido— se dice en el informe: `jsdom` no
 * tiene `AudioContext` y la suite no simula que suena.
 */

/** Estado de la barra. `loading` cubre resolver el ABC y cargar los samples. */
type PlayerState = 'idle' | 'loading' | 'playing' | 'no-abc' | 'no-audio' | 'failed';

/**
 * Programa General MIDI de cada instrumento, **tal y como los nombra `abcjs`**:
 * su tabla `instrumentIndexToName` del paquete instalado llama `fiddle` al 110,
 * `whistle` al 78, `accordion` al 21 y `banjo` al 105. De ahí sale el nombre que
 * `abcjs` pega en la URL (`<instrumento>-mp3/<nota>.mp3`), así que este número
 * es lo que decide **qué carpeta de samples suena**.
 */
const INSTRUMENT_PROGRAM: Record<PracticeInstrument, number> = {
  fiddle: 110,
  whistle: 78,
  accordion: 21,
  banjo: 105,
};

/** Lo que se lee en la barra; las claves de las preferencias van en minúsculas. */
const INSTRUMENT_LABELS: Record<PracticeInstrument, string> = {
  fiddle: 'Fiddle',
  whistle: 'Whistle',
  accordion: 'Accordion',
  banjo: 'Banjo',
};

/** El paquete tal y como lo devuelve `import('abcjs')` (con o sin `default`). */
type AbcjsModule = typeof import('abcjs');

/** El almacén del navegador, o `null` si no está (modo privado). */
function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** El ritmo que se muestra en la fila: override personal, luego el del tune. */
function rhythmOf(row: RepertoireRow): string | null {
  return row.custom_rhythm?.trim() || row.tune?.rhythm || null;
}

/** El instrumento guardado, con la preferencia por defecto como red. */
function initialInstrument(): PracticeInstrument {
  const store = browserStore();
  if (!store) return DEFAULT_PREFS.instrument;
  try {
    return readPrefs(store).instrument;
  } catch {
    return DEFAULT_PREFS.instrument;
  }
}

export function PracticePlayer(props: { row: RepertoireRow }): JSX.Element {
  const row = props.row;

  /**
   * Lo que ya viaja en la fila, sin red. Si no hay ABC pero el tune tiene
   * `origin_ref`, todavía se puede resolver: la barra arranca en `idle` y será
   * el primer ▶ quien lo averigüe.
   */
  const localSource = abcFromRow(row);
  const canResolveLater = Boolean(row.tune?.origin_ref);

  const [tempo, setTempo] = createSignal(tempoFor(rhythmOf(row)));
  const [instrument, setInstrument] = createSignal<PracticeInstrument>(initialInstrument());
  const [state, setState] = createSignal<PlayerState>(
    localSource.abc || canResolveLater ? 'idle' : 'no-abc'
  );
  const [looping, setLooping] = createSignal(false);
  const [scoreOpen, setScoreOpen] = createSignal(false);

  /** El ABC ya resuelto de esta fila; se pide una vez por componente. */
  let abcText: string | null = localSource.abc;
  /** El paquete cargado y el motor en curso; viven fuera de las señales. */
  let abcjs: AbcjsModule | null = null;
  let synth: MidiBuffer | null = null;
  /** El temporizador del loop. `null` = no hay vuelta pendiente. */
  let loopTimer: number | null = null;
  /** Generación del arranque en vuelo: un `init` lento no puede resucitar un motor parado. */
  let generation = 0;

  let sink!: HTMLDivElement;

  /**
   * Para todo lo que suena y lo que está a punto de sonar: cancela la vuelta
   * pendiente del loop, tira el motor y **sube la generación** para que
   * cualquier `init()` en vuelo se aborte al volver.
   */
  const teardownEngine = () => {
    generation += 1;
    if (loopTimer !== null) {
      window.clearTimeout(loopTimer);
      loopTimer = null;
    }
    const current = synth;
    synth = null;
    if (current) {
      try {
        current.stop();
      } catch {
        /* ya estaba parado: parar dos veces no es un error que importe */
      }
    }
  };

  /**
   * Se llama cuando el buffer termina **solo**. Dos guardas, y las dos hacen
   * falta:
   *   · `ticket !== generation` — el motor que avisa ya no es el que manda. Al
   *     parar o al volver a montar el motor para cambiar el tempo, el `onended`
   *     del buffer viejo llega tarde; sin esta guarda rearmaría el loop de un
   *     motor que ya está muerto.
   *   · `state()` ya en `idle` — parada manual: parar no es terminar.
   */
  const onTuneEnded = (ticket: number) => {
    if (ticket !== generation) return;
    if (state() !== 'playing') return;
    if (!looping()) {
      setState('idle');
      return;
    }
    loopTimer = window.setTimeout(() => {
      loopTimer = null;
      if (state() !== 'playing') return;
      try {
        synth?.start();
      } catch {
        setState('failed');
      }
    }, LOOP_GAP_MS);
  };

  const loadAbcjs = async (): Promise<AbcjsModule> => {
    if (abcjs) return abcjs;
    const loaded = (await import('abcjs')) as AbcjsModule & { default?: AbcjsModule };
    abcjs = loaded.default ?? loaded;
    return abcjs;
  };

  /** El ABC de la fila; la red solo se toca si la fila no lo traía. */
  const ensureAbc = async (): Promise<string | null> => {
    if (abcText) return abcText;
    abcText = await resolveAbc(row);
    return abcText;
  };

  /**
   * Monta el motor y arranca. La llamada exacta, contra el paquete instalado:
   *
   * ```ts
   * const visual = api.renderAbc(sink, abc, {})[0];
   * const engine = new api.synth.CreateSynth();
   * await engine.init({ visualObj: visual, options: { soundFontUrl, program, qpm, onEnded } });
   * await engine.prime();
   * engine.start();
   * ```
   *
   * `qpm` va en `options` porque es ahí donde `CreateSynth.init` lo lee: hace
   * `visualObj.setUpAudio(options)` → `flattened.tempo = options.qpm` y después
   * `millisecondsPerMeasure(flattened.tempo)`, que es la duración con la que se
   * colocan las notas. (Dibujar con `renderAbc(el, abc, { qpm })` no cambia
   * nada: `renderAbc` no lee `qpm` para el audio.) `onEnded` va también dentro
   * de `options`, que es de donde lo copia el paquete.
   */
  const startEngine = async (api: AbcjsModule, abc: string): Promise<void> => {
    const ticket = ++generation;
    const visual = api.renderAbc(sink, abc, {})[0];
    if (!visual) throw new Error('abcjs could not read this ABC');

    const engine = new api.synth.CreateSynth();
    await engine.init({
      visualObj: visual,
      options: {
        soundFontUrl: SOUNDFONT_URL,
        program: INSTRUMENT_PROGRAM[instrument()],
        qpm: tempo(),
        onEnded: () => onTuneEnded(ticket),
      },
    });
    if (ticket !== generation) {
      try {
        engine.stop();
      } catch {
        /* motor huérfano: se descarta */
      }
      return;
    }

    await engine.prime();
    if (ticket !== generation) {
      try {
        engine.stop();
      } catch {
        /* idem */
      }
      return;
    }

    synth = engine;
    engine.start();
    setState('playing');
  };

  const play = async () => {
    if (state() === 'playing') {
      setState('idle');
      teardownEngine();
      return;
    }
    if (state() !== 'idle' && state() !== 'failed') return;

    setState('loading');
    try {
      const abc = await ensureAbc();
      if (!abc) {
        setState('no-abc');
        return;
      }
      const api = await loadAbcjs();
      if (!api.synth.supportsAudio()) {
        setState('no-audio');
        return;
      }
      await startEngine(api, abc);
    } catch {
      teardownEngine();
      setState('failed');
    }
  };

  /** Vuelve a montar el motor con el tempo o el instrumento actuales. */
  const restartEngine = async () => {
    const abc = abcText;
    const api = abcjs;
    teardownEngine();
    if (!abc || !api) return;
    setState('loading');
    try {
      await startEngine(api, abc);
    } catch {
      teardownEngine();
      setState('failed');
    }
  };

  const shiftTempo = (delta: number) => {
    const next = clampTempo(tempo() + delta);
    if (next === tempo()) return;
    setTempo(next);
    // El tempo se fija al montar el motor: para que el cambio se oiga hay que
    // volver a montarlo. Solo si estaba sonando; parado, el próximo ▶ ya lo usa.
    if (state() === 'playing' || state() === 'loading') void restartEngine();
  };

  const toggleLoop = () => {
    const next = !looping();
    setLooping(next);
    if (next) return;
    // Sin loop no hay vuelta pendiente: cancelarla es lo que evita que la tune
    // vuelva a sonar sola después de haberlo apagado.
    if (loopTimer !== null) {
      window.clearTimeout(loopTimer);
      loopTimer = null;
      setState('idle');
    }
  };

  const cycleInstrument = () => {
    const list = INSTRUMENTS;
    const next = list[(list.indexOf(instrument()) + 1) % list.length];
    setInstrument(next);

    const store = browserStore();
    if (store) {
      try {
        // La preferencia es global, no por tune: se conserva el objetivo diario.
        writePrefs(store, { ...readPrefs(store), instrument: next });
      } catch {
        /* almacenamiento bloqueado: el selector funciona, solo no recuerda */
      }
    }

    if (state() === 'playing' || state() === 'loading') void restartEngine();
  };

  /**
   * Despliega la partitura. Se dibuja **al desplegar**, nunca antes, y dibujar
   * exige el ABC: si la fila no lo traía, este es el segundo sitio donde se
   * resuelve (el primero es el ▶).
   */
  const paintScore = async (host: HTMLDivElement) => {
    if (host.dataset.painted === '1') return;
    try {
      const abc = await ensureAbc();
      if (!abc) {
        setState('no-abc');
        return;
      }
      const api = await loadAbcjs();
      host.dataset.painted = '1';
      api.renderAbc(host, abc, { responsive: 'resize' });
    } catch {
      delete host.dataset.painted;
      setState('failed');
    }
  };

  const canPlay = () => state() === 'idle' || state() === 'playing';

  const playLabel = () => {
    const title = displayTitle(row);
    if (state() === 'playing') return `Stop ${title}`;
    if (state() === 'loading') return `Loading ${title}`;
    return `Play ${title}`;
  };

  const statusText = (): string | null => {
    const current = state();
    if (current === 'no-abc') return 'no ABC';
    if (current === 'no-audio') return 'audio unavailable';
    if (current === 'failed') return 'could not play';
    return null;
  };

  onCleanup(() => teardownEngine());

  return (
    <div class="practice-player">
      <div class="practice-player__bar">
        <button
          type="button"
          class="pp-btn pp-play"
          aria-label={playLabel()}
          aria-pressed={state() === 'playing' ? 'true' : 'false'}
          disabled={!canPlay()}
          onClick={() => void play()}
        >
          <span aria-hidden="true">{state() === 'playing' ? '■' : '▶'}</span>
        </button>

        <div class="pp-tempo" role="group" aria-label="Tempo">
          <button
            type="button"
            class="pp-step"
            aria-label="Slower"
            onClick={() => shiftTempo(-TEMPO_STEP)}
          >
            −
          </button>
          <span class="pp-tempo__value" aria-label="Beats per minute">
            {tempo()}
          </span>
          <button
            type="button"
            class="pp-step"
            aria-label="Faster"
            onClick={() => shiftTempo(TEMPO_STEP)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          class="pp-btn pp-loop"
          aria-label="Loop"
          aria-pressed={looping() ? 'true' : 'false'}
          onClick={toggleLoop}
        >
          <span aria-hidden="true">⟳</span>
        </button>

        <button
          type="button"
          class="pp-instrument"
          aria-label={`Instrument: ${INSTRUMENT_LABELS[instrument()]}`}
          onClick={cycleInstrument}
        >
          {INSTRUMENT_LABELS[instrument()]}
        </button>

        <button
          type="button"
          class="pp-score-toggle"
          aria-label={scoreOpen() ? 'Hide score' : 'Show score'}
          aria-expanded={scoreOpen() ? 'true' : 'false'}
          onClick={() => setScoreOpen(!scoreOpen())}
        >
          {scoreOpen() ? 'Hide score' : 'Score'}
        </button>

        <Show when={statusText()}>
          {(text) => (
            <span class="pp-status" role="status">
              {text()}
            </span>
          )}
        </Show>
      </div>

      <Show when={scoreOpen()}>
        <div
          class="pp-score"
          ref={(element) => {
            void paintScore(element);
          }}
        />
      </Show>

      {/*
        El blanco de `renderAbc` para el audio: el sintetizador necesita un
        `TuneObject`, y el único modo de obtenerlo es dibujar. Va fuera de la
        vista (no `display:none`: el engraver mide texto) y sin coste de lectura.
      */}
      <div class="pp-sink" aria-hidden="true" ref={sink} />
    </div>
  );
}
