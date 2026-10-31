// @vitest-environment jsdom
/**
 * La barra del reproductor (#38), montada de verdad.
 *
 * `abcjs` va **simulado**: lo que se prueba aquí es la orquestación —qué se
 * pide, cuándo, con qué tempo y qué se para—, no que suene. `jsdom` no tiene
 * `AudioContext`, así que la prueba del sonido no existe y no se finge: el
 * informe lo dice.
 *
 * Vitest corre sin `globals`: cada test importa lo suyo y `afterEach(cleanup)`
 * se declara aquí.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { mapRepertoireRow, type RepertoireRow } from '../lib/repertoire-model';
import { LOOP_GAP_MS } from '../lib/abc-player';

/**
 * El paquete de mentira. `vi.hoisted` es obligatorio: la fábrica de `vi.mock`
 * se eleva por encima de los `const` del módulo y no podría verlos.
 */
const mocked = vi.hoisted(() => {
  const engine = {
    init: vi.fn(async (_params: unknown) => ({ status: 'created' })),
    prime: vi.fn(async () => ({ status: 'prime', duration: 1 })),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const api = {
    renderAbc: vi.fn((_target: unknown, _abc: string, _params?: unknown) => [{ id: 'visual-obj' }]),
    synth: {
      CreateSynth: vi.fn(() => engine),
      supportsAudio: vi.fn(() => true),
    },
  };
  return { engine, api };
});

vi.mock('abcjs', () => ({ default: mocked.api, ...mocked.api }));

import { PracticePlayer } from './PracticePlayer';

const KESH = 'X:1\nT:Kesh, The\nM:6/8\nL:1/8\nK:G\nGED G2A|BAB GED|\n';

function row(
  overrides: { abc?: string | null; rhythm?: string | null; originRef?: string | null } = {}
): RepertoireRow {
  const { abc = KESH, rhythm = 'jig', originRef = '55' } = overrides;
  return mapRepertoireRow({
    id: 'rep-1',
    status: 'learning',
    custom_abc: null,
    custom_rhythm: null,
    custom_title: null,
    custom_key: null,
    notes: null,
    added_at: '2026-10-01T10:00:00Z',
    last_practiced_at: null,
    pr_tunes: {
      id: 'tune-1',
      origin: 'thesession',
      origin_ref: originRef,
      name: 'Kesh, The',
      rhythm,
      meter: '6/8',
      key: 'G',
      abc,
    },
  });
}

/** Deja correr las promesas del arranque (import, init, prime) sin tocar relojes. */
async function flush(times = 30): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

function playButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(play|stop|loading)/i }) as HTMLButtonElement;
}

function tempoValue(): string {
  return screen.getByLabelText('Beats per minute').textContent ?? '';
}

/** Lo que el componente le pasó a `CreateSynth().init()` la última vez. */
function lastInitOptions(): {
  visualObj: unknown;
  options: { soundFontUrl: string; program: number; qpm: number; onEnded: () => void };
} {
  const call = mocked.engine.init.mock.calls.at(-1);
  return (call as unknown as [{ visualObj: unknown; options: never }])[0];
}

beforeEach(() => {
  mocked.engine.init.mockClear();
  mocked.engine.prime.mockClear();
  mocked.engine.start.mockClear();
  mocked.engine.stop.mockClear();
  mocked.api.renderAbc.mockClear();
  mocked.api.synth.CreateSynth.mockClear();
  mocked.api.synth.supportsAudio.mockReset();
  mocked.api.synth.supportsAudio.mockReturnValue(true);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PracticePlayer bar', () => {
  it('paints the bar with the tempo of the rhythm', () => {
    render(() => <PracticePlayer row={row({ rhythm: 'jig' })} />);

    expect(tempoValue()).toBe('108');
    expect(screen.getByRole('button', { name: 'Instrument: Fiddle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Loop' })).toBeTruthy();
  });

  it('starts from the tempo of the rhythm the row really shows', () => {
    render(() => <PracticePlayer row={row({ rhythm: 'reel' })} />);
    expect(tempoValue()).toBe('84');
  });

  it('raises the tempo in steps of four and stops at the ceiling', () => {
    render(() => <PracticePlayer row={row({ rhythm: 'reel' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(tempoValue()).toBe('88');

    for (let index = 0; index < 60; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    }
    expect(tempoValue()).toBe('200');
  });

  it('lowers the tempo in steps of four and stops at the floor', () => {
    render(() => <PracticePlayer row={row({ rhythm: 'reel' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
    expect(tempoValue()).toBe('80');

    for (let index = 0; index < 30; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
    }
    expect(tempoValue()).toBe('40');
  });

  it('cycles the four instruments and remembers the choice', () => {
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Instrument: Fiddle' }));
    expect(screen.getByRole('button', { name: 'Instrument: Whistle' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('tt-practice-prefs') ?? '{}')).toMatchObject({
      instrument: 'whistle',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Instrument: Whistle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Instrument: Accordion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Instrument: Banjo' }));
    expect(screen.getByRole('button', { name: 'Instrument: Fiddle' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('tt-practice-prefs') ?? '{}')).toMatchObject({
      instrument: 'fiddle',
    });
  });

  it('disables play and says no ABC when the tune cannot have one', () => {
    render(() => <PracticePlayer row={row({ abc: null, originRef: null })} />);

    expect(screen.getByText('no ABC')).toBeTruthy();
    expect(playButton().disabled).toBe(true);
  });
});

describe('PracticePlayer playback', () => {
  it('resolves the ABC on the first play, not on mount', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => KESH,
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    render(() => <PracticePlayer row={row({ abc: null })} />);
    expect(fetchImpl).not.toHaveBeenCalled();

    fireEvent.click(playButton());
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://thesession.org/tunes/55/abc',
      expect.anything()
    );
    expect(mocked.engine.start).toHaveBeenCalledTimes(1);
  });

  it('renders with the tempo of the rhythm and the local soundfont', async () => {
    render(() => <PracticePlayer row={row({ rhythm: 'jig' })} />);

    fireEvent.click(playButton());
    await flush();

    const params = lastInitOptions();
    expect(params.options.qpm).toBe(108);
    expect(params.options.soundFontUrl).toBe('/soundfonts/');
    // `fiddle` es el 110 de la tabla de `abcjs`: de ahí sale la carpeta de samples.
    expect(params.options.program).toBe(110);
    expect(mocked.api.renderAbc).toHaveBeenCalledWith(expect.anything(), KESH, {});
    expect(mocked.engine.start).toHaveBeenCalledTimes(1);
  });

  it('changes what sounds when the tempo changes: re-mounts the engine at the new qpm', async () => {
    render(() => <PracticePlayer row={row({ rhythm: 'reel' })} />);

    fireEvent.click(playButton());
    await flush();
    expect(lastInitOptions().options.qpm).toBe(84);

    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    await flush();

    expect(mocked.api.synth.CreateSynth).toHaveBeenCalledTimes(2);
    expect(lastInitOptions().options.qpm).toBe(88);
    expect(mocked.engine.start).toHaveBeenCalledTimes(2);
  });

  it('changes what sounds when the instrument changes', async () => {
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    expect(lastInitOptions().options.program).toBe(110);

    fireEvent.click(screen.getByRole('button', { name: 'Instrument: Fiddle' }));
    await flush();

    expect(lastInitOptions().options.program).toBe(78);
  });

  it('stops with the same button that starts', async () => {
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    expect(playButton().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(playButton());
    expect(mocked.engine.stop).toHaveBeenCalledTimes(1);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('says audio unavailable instead of breaking the row when there is no WebAudio', async () => {
    mocked.api.synth.supportsAudio.mockReturnValue(false);
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();

    expect(screen.getByText('audio unavailable')).toBeTruthy();
    expect(playButton().disabled).toBe(true);
    expect(mocked.engine.start).not.toHaveBeenCalled();
  });

  it('says no ABC and disables play when the network has nothing either', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 410, ok: false, text: async () => 'gone' }))
    );
    render(() => <PracticePlayer row={row({ abc: null })} />);

    fireEvent.click(playButton());
    await flush();

    expect(screen.getByText('no ABC')).toBeTruthy();
    expect(playButton().disabled).toBe(true);
    expect(mocked.engine.start).not.toHaveBeenCalled();
  });

  it('does not draw the score until the score is asked for', async () => {
    render(() => <PracticePlayer row={row()} />);

    expect(document.querySelector('.pp-score')).toBeNull();
    expect(mocked.api.renderAbc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show score' }));
    await flush();

    expect(document.querySelector('.pp-score')).toBeTruthy();
    expect(mocked.api.renderAbc).toHaveBeenCalledTimes(1);
    // La partitura no arranca el sintetizador: dibujar no es sonar.
    expect(mocked.engine.start).not.toHaveBeenCalled();
  });
});

describe('PracticePlayer loop', () => {
  it('waits the loop gap after the tune ends and starts again', async () => {
    vi.useFakeTimers();
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    expect(screen.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed')).toBe('true');

    // El final natural del buffer: el motor avisa por `onEnded`.
    lastInitOptions().options.onEnded();

    vi.advanceTimersByTime(LOOP_GAP_MS - 1);
    expect(mocked.engine.start).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(mocked.engine.start).toHaveBeenCalledTimes(2);
  });

  it('stops after one pass when the loop is off', async () => {
    vi.useFakeTimers();
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();

    lastInitOptions().options.onEnded();
    vi.advanceTimersByTime(LOOP_GAP_MS * 3);

    expect(mocked.engine.start).toHaveBeenCalledTimes(1);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('cancels the pending restart when it is stopped inside the gap', async () => {
    vi.useFakeTimers();
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));

    lastInitOptions().options.onEnded();
    // Parar dentro de la pausa: el temporizador pendiente tiene que morir aquí.
    fireEvent.click(playButton());

    vi.advanceTimersByTime(LOOP_GAP_MS * 5);

    expect(mocked.engine.start).toHaveBeenCalledTimes(1);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('cancels the pending restart when the loop is switched off inside the gap', async () => {
    vi.useFakeTimers();
    render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));

    lastInitOptions().options.onEnded();
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));

    vi.advanceTimersByTime(LOOP_GAP_MS * 5);

    expect(mocked.engine.start).toHaveBeenCalledTimes(1);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores the end of an engine it has already replaced', async () => {
    vi.useFakeTimers();
    render(() => <PracticePlayer row={row({ rhythm: 'reel' })} />);

    fireEvent.click(playButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));

    // El `onended` del motor viejo llega tarde, después de cambiar el tempo.
    const staleEnded = lastInitOptions().options.onEnded;
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    await flush();

    staleEnded();
    vi.advanceTimersByTime(LOOP_GAP_MS * 3);

    // Dos arranques: el inicial y el del tempo nuevo. El final viejo no rearma nada.
    expect(mocked.engine.start).toHaveBeenCalledTimes(2);
  });

  it('takes the engine down when the row disappears', async () => {
    const view = render(() => <PracticePlayer row={row()} />);

    fireEvent.click(playButton());
    await flush();
    view.unmount();

    expect(mocked.engine.stop).toHaveBeenCalled();
  });
});
