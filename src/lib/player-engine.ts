import type { MidiBuffer } from 'abcjs';
import { SOUNDFONT_URL } from './abc-player';

/**
 * El motor de audio, **fuera del árbol de componentes** (#49).
 *
 * Es la pieza que hace que la música sobreviva a la navegación. El `Synth` de
 * `abcjs` envuelve un `AudioContext`, y un `createContext` de Solid no basta:
 * si el motor viviera en un componente, navegar de la home a la ficha lo
 * desmontaría y el `AudioContext` se recrearía (o se suspendería) en cada ruta.
 * Aquí vive en el módulo: se monta una vez por carga de página y solo lo para
 * quien manda —el ✕, el `Esc` o el final de la tune sin loop—.
 *
 * Tres reglas que esta capa respeta y que no son cosméticas:
 *   · **`abcjs` entra por `import()` dinámico.** El paquete pesa ~500 KB y no
 *     puede caer en el bundle de la home por un dock que casi nunca se abre.
 *   · **Nadie toca el motor desde fuera.** `startEngine` para lo que hubiera
 *     antes: un dock, un motor, nunca dos fuentes a la vez.
 *   · **Un arranque lento no resucita un motor parado.** La generación sube en
 *     cada parada y en cada arranque; un `init()` que vuelve tarde se descarta
 *     en vez de empezar a sonar sobre un dock ya cerrado.
 */

type AbcjsModule = typeof import('abcjs');

/** Lo que pide un arranque. `onEnded` lo pone el store: aquí no hay política de loop. */
export interface EngineRequest {
  abc: string;
  sink: HTMLElement;
  qpm: number;
  /** Programa General MIDI (`fiddle` 110, `whistle` 78, `accordion` 21, `banjo` 105). */
  program: number;
  onEnded: () => void;
}

/** «Se descartó porque llegó tarde», que no es un fallo que haya que enseñar. */
export const ABORTED = 'aborted' as const;

export type EngineResult =
  | { result: 'ok'; durationSec: number | null }
  | { result: 'no-audio' | 'failed'; durationSec: null }
  | typeof ABORTED;

let api: AbcjsModule | null = null;
let synth: MidiBuffer | null = null;
let generation = 0;

/** El paquete ya cargado, o cargándolo. Una sola promesa para todos. */
let loading: Promise<AbcjsModule> | null = null;

function loadAbcjs(): Promise<AbcjsModule> {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = import('abcjs').then((loaded) => {
      const module = (loaded as AbcjsModule & { default?: AbcjsModule }).default ?? loaded;
      api = module;
      return module;
    });
  }
  return loading;
}

/**
 * Para todo lo que suena y lo que está a punto de sonar. Sube la generación
 * **antes** de parar: así el `onEnded` del buffer que se acaba de parar —que
 * llega tarde— no rearma nada.
 */
export function stopEngine(): void {
  generation += 1;
  const current = synth;
  synth = null;
  if (current) {
    try {
      current.stop();
    } catch {
      /* ya estaba parado: parar dos veces no es un error que importe */
    }
  }
}

/**
 * La duración real de la tune, en segundos.
 *
 * **No sale de `visual.getTotalTime()`**: ese `totalTime` lo rellena
 * `setTiming()`, que es el camino de la animación/`TimingCallbacks`, y `init` no
 * lo llama — devuelve `undefined` y por eso la primera versión del dock se
 * quedaba sin duración (medido en el navegador, no supuesto).
 *
 * Lo que sí queda puesto tras `init` es `millisecondsPerMeasure` y
 * `flattened.totalDuration`; `abcjs` compone con ellos su propio
 * `self.duration = totalDuration × (msPorCompás / 1000) / meterSize`. Se usa ese
 * valor si ya está (lo escribe `start()`), y si no, la misma cuenta. Si ninguna
 * da un número positivo, se omite: mejor sin duración que con una inventada.
 */
function readDuration(engine: MidiBuffer, visual: { getTotalTime?: () => number }): number | null {
  const synth = engine as MidiBuffer & {
    duration?: number;
    millisecondsPerMeasure?: number;
    meterSize?: number;
    flattened?: { totalDuration?: number };
  };

  const direct = synth.duration;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;

  const total = synth.flattened?.totalDuration;
  const perMeasure = synth.millisecondsPerMeasure;
  const meterSize = synth.meterSize;
  if (
    typeof total === 'number' &&
    Number.isFinite(total) &&
    total > 0 &&
    typeof perMeasure === 'number' &&
    perMeasure > 0 &&
    typeof meterSize === 'number' &&
    meterSize > 0
  ) {
    return (total * (perMeasure / 1000)) / meterSize;
  }

  try {
    const fallback = visual.getTotalTime?.();
    if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback;
  } catch {
    /* sin duración se sigue: la línea de meta la omite */
  }
  return null;
}

/**
 * Monta y arranca. La llamada exacta, contra el paquete instalado (6.7.2):
 *
 * ```ts
 * const visual = api.renderAbc(sink, abc, {})[0];
 * const engine = new api.synth.CreateSynth();
 * await engine.init({ visualObj: visual, options: { soundFontUrl, program, qpm, onEnded } });
 * await engine.prime();
 * engine.start();
 * ```
 *
 * `qpm` va dentro de `options` porque es ahí donde `CreateSynth.init` lo lee:
 * hace `visualObj.setUpAudio(options)` → `flattened.tempo = options.qpm` y
 * después `millisecondsPerMeasure(...)`. `renderAbc(el, abc, { qpm })` **no**
 * cambia nada: dibujar no lee `qpm` para el audio. Y `onEnded` va también dentro
 * de `options`, que es de donde lo copia el paquete.
 */
export async function startEngine(request: EngineRequest): Promise<EngineResult> {
  stopEngine();
  const ticket = generation;

  try {
    const module = await loadAbcjs();
    if (ticket !== generation) return ABORTED;

    if (!module.synth.supportsAudio()) {
      return { result: 'no-audio', durationSec: null };
    }

    const visual = module.renderAbc(request.sink, request.abc, {})[0];
    if (!visual) return { result: 'failed', durationSec: null };

    const engine = new module.synth.CreateSynth();
    await engine.init({
      visualObj: visual,
      options: {
        soundFontUrl: SOUNDFONT_URL,
        program: request.program,
        qpm: request.qpm,
        onEnded: request.onEnded,
      },
    });
    if (ticket !== generation) {
      try {
        engine.stop();
      } catch {
        /* motor huérfano: se descarta */
      }
      return ABORTED;
    }

    await engine.prime();
    if (ticket !== generation) {
      try {
        engine.stop();
      } catch {
        /* idem */
      }
      return ABORTED;
    }

    synth = engine;
    engine.start();

    return { result: 'ok', durationSec: readDuration(engine, visual) };
  } catch {
    stopEngine();
    return { result: 'failed', durationSec: null };
  }
}

/**
 * Dibuja la partitura **cuando se pide**, nunca al abrir. Es el segundo sitio
 * donde se carga `abcjs`: si el usuario solo quiere oír, no se paga el dibujo.
 */
export async function renderScore(host: HTMLElement, abc: string): Promise<boolean> {
  try {
    const module = await loadAbcjs();
    module.renderAbc(host, abc, { responsive: 'resize' });
    return true;
  } catch {
    return false;
  }
}

/** Solo para pruebas: deja el módulo como recién importado. */
export function resetEngineForTests(): void {
  stopEngine();
  api = null;
  loading = null;
}
