import { describe, expect, it } from 'vitest';
import {
  canPlay,
  dockReserve,
  formatDuration,
  hasVideoControl,
  metaParts,
  pickSegment,
  statusText,
  type DockState,
} from './player-model';
import type { TuneSegment } from './tradtube';

/**
 * El modelo del reproductor flotante (#49), sin DOM ni `abcjs`.
 *
 * Lo que se prueba aquí es lo que el dock **dice** y lo que **deja hacer**:
 * cuándo el ▶ está disponible, qué se lee cuando algo falla, cómo se compone la
 * línea de metadatos y cuánto relleno pide el cuerpo. El sonido no se finge: eso
 * es `jsdom`, y se dice en el informe.
 */

const segment = (overrides: Partial<TuneSegment> = {}): TuneSegment => ({
  originRef: '55',
  mediaId: 'm-1',
  title: null,
  youtubeId: 'abcdefghijk',
  startSec: 0,
  endSec: 60,
  position: 0,
  unavailable: false,
  ...overrides,
});

describe('estados del dock', () => {
  it('nombra en la línea de meta solo los tres fallos que el usuario puede leer', () => {
    expect(statusText('no-abc')).toBe('no ABC');
    expect(statusText('no-audio')).toBe('audio unavailable');
    expect(statusText('failed')).toBe('could not play');
    // Un estado sano no escribe nada: la línea lleva los metadatos.
    expect(statusText('idle')).toBeNull();
    expect(statusText('loading')).toBeNull();
    expect(statusText('playing')).toBeNull();
    expect(statusText('closed')).toBeNull();
  });

  it('deja pulsar el ▶ en reposo, sonando y tras un fallo; nunca mientras carga o sin audio', () => {
    const playable: DockState[] = ['idle', 'playing', 'failed'];
    const blocked: DockState[] = ['closed', 'loading', 'no-abc', 'no-audio'];
    for (const state of playable) expect(canPlay(state), state).toBe(true);
    for (const state of blocked) expect(canPlay(state), state).toBe(false);
  });
});

describe('duración', () => {
  it('la escribe como m:ss y omite lo que no es una duración', () => {
    expect(formatDuration(52)).toBe('0:52');
    expect(formatDuration(312)).toBe('5:12');
    expect(formatDuration(7.4)).toBe('0:07');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('no inventa un cero: sin dato, sin hueco', () => {
    for (const value of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(value), String(value)).toBeNull();
    }
  });
});

describe('línea de metadatos', () => {
  it('compone ritmo, tonalidad, procedencia, instrumento y duración en ese orden', () => {
    expect(
      metaParts({
        rhythm: 'Reel',
        key: 'D',
        source: 'ABC',
        instrument: 'Fiddle',
        durationSec: 52,
      })
    ).toEqual(['Reel', 'D', 'ABC', 'Fiddle', '0:52']);
  });

  it('omite lo que falta en vez de rellenarlo con un guion', () => {
    expect(
      metaParts({
        rhythm: 'Jig',
        key: null,
        source: 'TradTube',
        instrument: null,
        durationSec: null,
      })
    ).toEqual(['Jig', 'TradTube']);
  });

  it('sin nada que decir devuelve una lista vacía, no una cadena de separadores', () => {
    expect(
      metaParts({ rhythm: null, key: null, source: null, instrument: null, durationSec: null })
    ).toEqual([]);
  });
});

describe('vídeo', () => {
  it('abre el primer segmento disponible, no el primero a secas', () => {
    const segments = [
      segment({ mediaId: 'caido', unavailable: true }),
      segment({ mediaId: 'sano', unavailable: false }),
    ];
    expect(pickSegment(segments)?.mediaId).toBe('sano');
  });

  it('si todos están caídos deja el primero y el control se deshabilita', () => {
    const segments = [segment({ mediaId: 'a', unavailable: true })];
    expect(pickSegment(segments)?.mediaId).toBe('a');
    expect(hasVideoControl(segments)).toBe(true);
  });

  it('sin ningún segmento el control no existe', () => {
    expect(pickSegment([])).toBeNull();
    expect(hasVideoControl([])).toBe(false);
  });
});

describe('relleno del cuerpo', () => {
  it('cierra sin reservar, en reposo reserva 90 y con la bandeja 190', () => {
    expect(dockReserve('closed', false)).toBe(0);
    expect(dockReserve('idle', false)).toBe(90);
    expect(dockReserve('playing', false)).toBe(90);
    // La bandeja manda sobre el estado: también con el dock en reposo sonando.
    expect(dockReserve('playing', true)).toBe(190);
    expect(dockReserve('no-abc', true)).toBe(190);
  });
});
