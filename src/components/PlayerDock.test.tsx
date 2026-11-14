// @vitest-environment jsdom
/**
 * El reproductor flotante (#49), montado de verdad.
 *
 * `abcjs`, el motor y TradTube van **simulados**: lo que se prueba aquí es la
 * máquina de estados y el cableado —qué se abre, qué se para, qué se desmonta—,
 * no que suene. `jsdom` no tiene `AudioContext` y no se finge que lo tenga: el
 * sonido se comprueba con sesión efímera, fuera de la suite.
 *
 * El store es un singleton de módulo, así que cada prueba lo devuelve a
 * `closed` en `beforeEach`; sin eso, el dock de una prueba gobernaría la
 * siguiente y el fallo parecería del componente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { For } from 'solid-js';

vi.mock('../lib/player-engine', () => ({
  ABORTED: 'aborted',
  startEngine: vi.fn(),
  stopEngine: vi.fn(),
  renderScore: vi.fn(async () => true),
}));

vi.mock('../lib/tradtube', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tradtube')>();
  return { ...actual, fetchSegments: vi.fn() };
});

/*
 * El reproductor de YouTube no existe en `jsdom`. El doble no simula el vídeo:
 * crea el `<iframe>` que crearía YouTube (para que el desmontaje se pruebe de
 * verdad) y devuelve un mando con espías, de modo que los eventos del player se
 * disparan desde la prueba con las mismas funciones que usa el reproductor.
 */
vi.mock('../lib/video-player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/video-player')>();
  return { ...actual, mountVideoPlayer: vi.fn() };
});

import { startEngine, stopEngine } from '../lib/player-engine';
import { fetchSegments, type TuneSegment } from '../lib/tradtube';
import { VIDEO_RATES, mountVideoPlayer, type VideoPlayerHandle } from '../lib/video-player';
import { resetPlayerForTests, videoRateChanged, videoStateChanged } from '../lib/player-store';
import type { RepertoireRow } from '../lib/repertoire-model';
import PlayTrigger from './PlayTrigger';
import { PlayerDock } from './PlayerDock';

const mockedStart = vi.mocked(startEngine);
const mockedStop = vi.mocked(stopEngine);
const mockedSegments = vi.mocked(fetchSegments);
const mockedMount = vi.mocked(mountVideoPlayer);

type FakePlayer = VideoPlayerHandle & {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setRate: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

/** El mando que devuelve el montaje simulado, con el iframe que pondría YouTube. */
let player: FakePlayer;

function fakePlayer(host: HTMLElement): FakePlayer {
  const iframe = document.createElement('iframe');
  host.replaceChildren(iframe);
  return {
    play: vi.fn(),
    pause: vi.fn(),
    setRate: vi.fn(),
    destroy: vi.fn(() => iframe.remove()),
  };
}

function row(overrides: Partial<RepertoireRow> = {}): RepertoireRow {
  return {
    id: 'row-a',
    status: 'learning',
    shelved: false,
    favorite: false,
    rating: null,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    customAbc: null,
    notes: null,
    added_at: '2026-09-01T10:00:00Z',
    last_practiced_day: null,
    status_changed_at: null,
    tune: {
      id: 'tune-a',
      origin: 'thesession',
      origin_ref: '55',
      name: 'Kesh, The',
      rhythm: 'Jig',
      meter: '6/8',
      key: 'D',
      abc: 'X:1\nT:Kesh, The\nM:6/8\nL:1/8\nK:D\n|D2F|\n',
      composer: null,
    },
    image: null,
    practice_count: 0,
    avg_quality: null,
    days_since_last_practice: null,
    ...overrides,
  };
}

const segment = (overrides: Partial<TuneSegment> = {}): TuneSegment => ({
  originRef: '55',
  mediaId: 'm-1',
  title: 'Kesh on fiddle',
  youtubeId: 'abcdefghijk',
  startSec: 0,
  endSec: 60,
  position: 0,
  unavailable: false,
  ...overrides,
});

function Harness(props: { rows?: RepertoireRow[] }) {
  return (
    <>
      <For each={props.rows ?? [row()]}>{(item) => <PlayTrigger row={item} />}</For>
      <PlayerDock />
    </>
  );
}

const dock = () => document.querySelector('.player-dock');
const openDock = async (name = /Play The Kesh/) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(dock()).not.toBeNull());
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPlayerForTests();
  mockedStart.mockResolvedValue({ result: 'ok', durationSec: 52 });
  mockedSegments.mockResolvedValue(new Map());
  mockedMount.mockImplementation(async ({ host }) => {
    player = fakePlayer(host);
    return { handle: player, rates: VIDEO_RATES };
  });
});

afterEach(cleanup);

describe('apertura y cierre', () => {
  it('nace cerrado: sin dock en el DOM y con el disparador en su sitio', () => {
    render(() => <Harness />);
    expect(dock()).toBeNull();
    expect(screen.getByRole('button', { name: 'Play The Kesh' })).toBeTruthy();
  });

  it('un ▶ abre el dock, suena y enseña título y metadatos', async () => {
    render(() => <Harness />);
    await openDock();

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Player' }).textContent).toContain('The Kesh')
    );
    expect(mockedStart).toHaveBeenCalledTimes(1);
    // Ritmo, tonalidad, procedencia, instrumento y duración real del motor.
    expect(dock()!.textContent).toContain('Jig · D · ABC · Fiddle · 0:52');
    // Un solo dock aunque haya varias filas.
    expect(document.querySelectorAll('.player-dock')).toHaveLength(1);
  });

  it('el ✕ para el motor y deja `closed`: el disparador vuelve a empezar de cero', async () => {
    render(() => <Harness />);
    await openDock();
    await waitFor(() => expect(mockedStart).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));

    expect(dock()).toBeNull();
    expect(mockedStop).toHaveBeenCalled();

    await openDock();
    await waitFor(() => expect(mockedStart).toHaveBeenCalledTimes(2));
  });

  it('`Esc` cierra el dock igual que el ✕', async () => {
    render(() => <Harness />);
    await openDock();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dock()).toBeNull();
  });
});

describe('vídeo', () => {
  it('abre el iframe y para el sintetizador: nunca dos fuentes a la vez', async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment()]]]));
    render(() => <Harness />);
    await openDock();

    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));
    const video = await screen.findByRole('button', { name: 'Play video' });

    mockedStop.mockClear();
    fireEvent.click(video);

    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    expect(mockedStop).toHaveBeenCalled();
    // El dock sigue ahí: se cierra el vídeo, no el reproductor.
    expect(dock()).not.toBeNull();
  });

  it('el ✕ del marco desmonta el iframe y deja el dock abierto', async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment()]]]));
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Close video' }));

    // Fuera del DOM, no oculto: un iframe con `display:none` sigue sonando.
    expect(document.querySelector('.player-dock__video iframe')).toBeNull();
    expect(dock()).not.toBeNull();
  });

  it('sin segmento de TradTube el control de vídeo no se pinta', async () => {
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));

    expect(screen.getByRole('button', { name: 'Loop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });
});

describe('vídeo: velocidad propia y control desde el dock', () => {
  /** Abre el vídeo y espera a que el player esté montado (▶ habilitado). */
  const openVideoPanel = async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment()]]]));
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Play video' }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  };

  it('el ▶ del dock pausa y reanuda el vídeo, y no arranca el sintetizador', async () => {
    await openVideoPanel();
    mockedStart.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(player.play).toHaveBeenCalledTimes(1);

    // YouTube confirma que suena: el dock lo refleja.
    videoStateChanged('playing');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    expect(player.pause).toHaveBeenCalledTimes(1);

    videoStateChanged('paused');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy());
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('la velocidad recorre los escalones en % y los aplica en caliente', async () => {
    await openVideoPanel();
    expect(screen.getByText('100%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Faster video' }));
    expect(screen.getByText('125%')).toBeTruthy();
    expect(player.setRate).toHaveBeenLastCalledWith(1.25);

    fireEvent.click(screen.getByRole('button', { name: 'Slower video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slower video' }));
    expect(screen.getByText('75%')).toBeTruthy();
    expect(player.setRate).toHaveBeenLastCalledWith(0.75);
  });

  it('en los extremos, el botón sin escalón queda deshabilitado', async () => {
    await openVideoPanel();
    const slower = screen.getByRole('button', { name: 'Slower video' }) as HTMLButtonElement;
    const faster = screen.getByRole('button', { name: 'Faster video' }) as HTMLButtonElement;

    for (let step = 0; step < 3; step += 1) fireEvent.click(slower);
    expect(screen.getByText('25%')).toBeTruthy();
    expect(slower.disabled).toBe(true);

    for (let step = 0; step < 7; step += 1) fireEvent.click(faster);
    expect(screen.getByText('200%')).toBeTruthy();
    expect(faster.disabled).toBe(true);
  });

  it('el menú nativo de YouTube mueve el rótulo sin reenviar la orden', async () => {
    await openVideoPanel();
    const sent = player.setRate.mock.calls.length;

    videoRateChanged(1.5);

    await waitFor(() => expect(screen.getByText('150%')).toBeTruthy());
    expect(player.setRate).toHaveBeenCalledTimes(sent);
  });

  it('cerrar el vídeo destruye el player y su iframe sale del DOM', async () => {
    await openVideoPanel();
    expect(document.querySelector('.player-dock__video iframe')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close video' }));

    expect(player.destroy).toHaveBeenCalled();
    expect(document.querySelector('.player-dock__video iframe')).toBeNull();
    expect(dock()).not.toBeNull();
  });

  it('el chevron se llama por el vídeo cuando el vídeo está abierto', async () => {
    await openVideoPanel();
    expect(screen.getByRole('button', { name: 'Hide video' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide player controls' })).toBeNull();
  });

  it('plegar el dock oculta el vídeo sin destruir el reproductor', async () => {
    await openVideoPanel();
    const iframe = document.querySelector('.player-dock__video iframe');
    expect(iframe).not.toBeNull();

    // Clic real (JS basta aquí: no hay autoplay que autorizar) en el chevron.
    fireEvent.click(screen.getByRole('button', { name: 'Hide video' }));

    const panel = document.querySelector('.player-dock__video');
    expect(panel!.classList.contains('is-collapsed')).toBe(true);
    // El reproductor NO se destruye: sigue montado y sonando (medido: display:none no pausa).
    expect(document.contains(iframe)).toBe(true);
    expect(player.destroy).not.toHaveBeenCalled();
    // La barra sigue mandando: el ▶ está disponible y su sujeto es el vídeo.
    const bar = screen.getByRole('button', { name: 'Play video' }) as HTMLButtonElement;
    expect(bar.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show video' }));
    expect(document.querySelector('.player-dock__video')!.classList.contains('is-collapsed')).toBe(false);
  });

  it('con el dock plegado, el ▶ de la barra sigue gobernando el vídeo', async () => {
    await openVideoPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Hide video' }));
    mockedStart.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('si la IFrame API no carga, el vídeo se ve pero el dock no lo gobierna', async () => {
    mockedMount.mockRejectedValue(new Error('YouTube IFrame API failed to load'));
    mockedSegments.mockResolvedValue(new Map([['55', [segment()]]]));
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));

    // El iframe plano de siempre sigue ahí: el vídeo no desaparece.
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    const button = screen.getByRole('button', { name: 'Video controls unavailable' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Y no hay barra de velocidad que mienta: sin player no hay nada que mover.
    expect(screen.queryByRole('button', { name: 'Faster video' })).toBeNull();
  });
});

describe('estados que no pueden reproducir', () => {
  it('sin ABC lo dice en la línea de meta y deshabilita el ▶', async () => {
    const bare = row({
      id: 'row-b',
      tune: {
        id: 'tune-b',
        origin: 'manual',
        origin_ref: null,
        name: 'Sin fuentes',
        rhythm: 'Reel',
        meter: '4/4',
        key: null,
        abc: null,
        composer: null,
      },
    });
    render(() => <Harness rows={[bare]} />);
    await openDock(/Play Sin fuentes/);

    await waitFor(() => expect(dock()!.textContent).toContain('no ABC'));
    // El ▶ del dock, no el disparador de la fila: los dos llevan el título.
    const dockPlay = within(screen.getByRole('region', { name: 'Player' })).getByRole('button', {
      name: /Play Sin fuentes/,
    });
    expect(dockPlay.hasAttribute('disabled')).toBe(true);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('sin WebAudio dice `audio unavailable` en vez de romper el dock', async () => {
    mockedStart.mockResolvedValue({ result: 'no-audio', durationSec: null });
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(dock()!.textContent).toContain('audio unavailable'));
  });
});

describe('bandeja', () => {
  it('el tempo se mueve en pasos de cuatro y el instrumento recorre la rueda', async () => {
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));

    // Jig arranca en 108; un paso arriba son 112.
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(screen.getByLabelText('Beats per minute').textContent).toBe('112');

    const instrument = screen.getByRole('button', { name: /^Instrument:/ });
    const first = instrument.textContent;
    fireEvent.click(instrument);
    expect(screen.getByRole('button', { name: /^Instrument:/ }).textContent).not.toBe(first);
  });
});
