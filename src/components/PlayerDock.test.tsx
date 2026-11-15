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
 * Las versiones de ABC se piden a TheSession: en `jsdom` eso sería una salida a
 * internet en cada prueba. Se sustituye solo `loadVersions` —lo puro se queda
 * real— y cada caso decide qué devuelve.
 */
vi.mock('../lib/abc-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/abc-source')>();
  return { ...actual, loadVersions: vi.fn() };
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

/*
 * Guardar una preferencia escribe en Supabase (`pr_repertoire`): en `jsdom` eso
 * sería una salida a internet. Se sustituyen solo las dos escrituras; el resto
 * del módulo se queda real.
 */
vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return {
    ...actual,
    savePreferredSetting: vi.fn(async () => undefined),
    savePreferredMedia: vi.fn(async () => undefined),
  };
});

import { startEngine, stopEngine } from '../lib/player-engine';
import { loadVersions } from '../lib/abc-source';
import { fetchSegments, type TuneSegment } from '../lib/tradtube';
import { mountVideoPlayer, type VideoPlayerHandle } from '../lib/video-player';
import { savePreferredMedia } from '../lib/repertoire';
import {
  resetPlayerForTests,
  toggleLoop,
  videoRateChanged,
  videoStateChanged,
} from '../lib/player-store';
import type { RepertoireRow } from '../lib/repertoire-model';
import PlayTrigger from './PlayTrigger';
import { PlayerDock } from './PlayerDock';

const mockedStart = vi.mocked(startEngine);
const mockedStop = vi.mocked(stopEngine);
const mockedSegments = vi.mocked(fetchSegments);
const mockedMount = vi.mocked(mountVideoPlayer);
const mockedVersions = vi.mocked(loadVersions);
const mockedSaveMedia = vi.mocked(savePreferredMedia);

type FakePlayer = VideoPlayerHandle & {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setRate: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
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
    seek: vi.fn(),
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
    preferredSetting: null,
    preferredMedia: null,
    notes: null,
    added_at: '2026-09-01T10:00:00Z',
    learnedOn: null,
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
      keys: [],
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
  // Sin versiones de red por defecto: cada caso que las quiera las declara.
  mockedVersions.mockResolvedValue({ versions: [], origin: 'none' });
  mockedMount.mockImplementation(async ({ host }) => {
    player = fakePlayer(host);
    return player;
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
    await waitFor(() => expect(dock()!.textContent).toContain('Jig · D · ABC · Fiddle · 0:52'));
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

describe('vídeo por defecto (#59)', () => {
  const withVideo = () =>
    mockedSegments.mockResolvedValue(new Map([['55', [segment({ startSec: 12 })]]]));

  it('con segmento disponible suena el vídeo, no el sintetizador', async () => {
    withVideo();
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    expect(mockedStart).not.toHaveBeenCalled();
    expect(mockedStop).toHaveBeenCalled();
  });

  it('sin segmento suena el sintetizador, como antes', async () => {
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(mockedStart).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.player-dock__video')).toBeNull();
  });

  it('con el segmento caído se suena y el control de vídeo queda deshabilitado', async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment({ unavailable: true })]]]));
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(mockedStart).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));
    const control = screen.getByRole('button', { name: 'Play video' }) as HTMLButtonElement;
    expect(control.disabled).toBe(true);
  });

  it('el botón ABC del panel devuelve al sintetizador y desmonta el iframe', async () => {
    withVideo();
    render(() => <Harness />);
    await openDock();
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Play with ABC' }));

    await waitFor(() => expect(mockedStart).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.player-dock__video iframe')).toBeNull();
    expect(dock()).not.toBeNull();
  });

  it('el ✕ del marco desmonta el iframe y deja el dock abierto', async () => {
    withVideo();
    render(() => <Harness />);
    await openDock();
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

describe('vídeo: velocidad por pasos del 5 % y mandos del tune', () => {
  /** Abre la tune; el vídeo se abre solo y el player tarda en estar listo. */
  const openVideoPanel = async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment({ startSec: 12 })]]]));
    render(() => <Harness />);
    await openDock();
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

  it('la velocidad se mueve de cinco en cinco y se aplica en caliente', async () => {
    await openVideoPanel();
    expect(screen.getByText('100%')).toBeTruthy();
    // A 100 % no hay paso hacia arriba: es el techo del dominio.
    expect((screen.getByRole('button', { name: 'Faster video' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.click(screen.getByRole('button', { name: 'Slower video' }));
    expect(screen.getByText('95%')).toBeTruthy();
    expect(player.setRate).toHaveBeenLastCalledWith(0.95);

    fireEvent.click(screen.getByRole('button', { name: 'Slower video' }));
    expect(screen.getByText('90%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Faster video' }));
    expect(screen.getByText('95%')).toBeTruthy();
    expect(player.setRate).toHaveBeenLastCalledWith(0.95);
  });

  it('en los extremos, el botón sin paso queda deshabilitado', async () => {
    await openVideoPanel();
    const slower = screen.getByRole('button', { name: 'Slower video' }) as HTMLButtonElement;
    const faster = screen.getByRole('button', { name: 'Faster video' }) as HTMLButtonElement;

    for (let step = 0; step < 10; step += 1) fireEvent.click(slower);
    expect(screen.getByText('50%')).toBeTruthy();
    expect(slower.disabled).toBe(true);

    for (let step = 0; step < 10; step += 1) fireEvent.click(faster);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(faster.disabled).toBe(true);
  });

  it('el menú nativo de YouTube mueve el rótulo sin reenviar la orden', async () => {
    await openVideoPanel();
    const sent = player.setRate.mock.calls.length;

    videoRateChanged(0.55);

    await waitFor(() => expect(screen.getByText('55%')).toBeTruthy());
    expect(player.setRate).toHaveBeenCalledTimes(sent);
  });

  it('«Tune start» vuelve al inicio del segmento, no al del vídeo', async () => {
    await openVideoPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Back to tune start' }));

    expect(player.seek).toHaveBeenCalledWith(12);
    // Parado sigue parado: el botón no arranca la reproducción por su cuenta.
    expect(player.play).not.toHaveBeenCalled();
  });

  it('el check de loop reinicia el tune al llegar al final', async () => {
    await openVideoPanel();
    videoStateChanged('playing');

    const loop = screen.getByRole('checkbox', { name: 'Loop' }) as HTMLInputElement;
    fireEvent.click(loop);
    expect(loop.checked).toBe(true);

    videoStateChanged('ended');

    expect(player.seek).toHaveBeenCalledWith(12);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('sin loop, el final del segmento no vuelve a arrancar nada', async () => {
    await openVideoPanel();
    videoStateChanged('playing');

    videoStateChanged('ended');

    expect(player.seek).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
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
    expect(document.querySelector('.player-dock__video')!.classList.contains('is-collapsed')).toBe(
      false
    );
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

    // El iframe plano de siempre sigue ahí: el vídeo no desaparece.
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    const button = screen.getByRole('button', {
      name: 'Video controls unavailable',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Y no hay barra de velocidad que mienta: sin player no hay nada que mover.
    expect(screen.queryByRole('button', { name: 'Faster video' })).toBeNull();
  });
});

describe('versiones de ABC (#59)', () => {
  const TWO = [
    { id: 'setting1', label: '1 · G', abc: 'X: 1\nT: Kesh, The\nM:6/8\nL:1/8\nK:G\nGAB cde|\n' },
    { id: 'setting2', label: '2 · D', abc: 'X: 2\nT: Kesh, The\nM:6/8\nL:1/8\nK:D\nDEF GAB|\n' },
  ];

  it('el selector aparece cuando hay más de una versión y la elegida es la que suena', async () => {
    mockedVersions.mockResolvedValue({ versions: TWO, origin: 'thesession' });
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    fireEvent.change(select, { target: { value: 'setting2' } });

    await waitFor(() =>
      expect(mockedStart).toHaveBeenCalledWith(
        expect.objectContaining({ abc: expect.stringContaining('DEF GAB|') })
      )
    );
  });

  it('con una sola versión no hay selector que enseñar', async () => {
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));

    expect(screen.queryByRole('combobox')).toBeNull();
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
        keys: [],
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
  it('el tempo se mueve en pasos de diez y el instrumento recorre la rueda', async () => {
    render(() => <Harness />);
    await openDock();
    fireEvent.click(screen.getByRole('button', { name: 'Show player controls' }));

    // Jig arranca en 108; un paso arriba son 118 (#59: antes 4, ahora 10).
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(screen.getByLabelText('Beats per minute').textContent).toBe('118');

    const instrument = screen.getByRole('button', { name: /^Instrument:/ });
    const first = instrument.textContent;
    fireEvent.click(instrument);
    expect(screen.getByRole('button', { name: /^Instrument:/ }).textContent).not.toBe(first);
  });
});

describe('vídeo preferido (#64)', () => {
  /** Dos vídeos de la misma tune: el segundo es el que el usuario quiere fijar. */
  const twoVideos = () =>
    mockedSegments.mockResolvedValue(
      new Map([
        [
          '55',
          [
            segment({ mediaId: 'm-1', title: 'Kesh on fiddle' }),
            segment({
              mediaId: 'm-2',
              title: 'Kesh in a session',
              position: 1,
              startSec: 90,
              endSec: 150,
            }),
          ],
        ],
      ])
    );

  it('con varios vídeos se ofrece el selector y arranca el primero', async () => {
    twoVideos();
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    const select = screen.getByRole('combobox', { name: 'Video' }) as HTMLSelectElement;
    expect(select.value).toBe('m-1');
    // Dos vídeos, un `<option>` cada uno; el título es el rótulo.
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['m-1', 'm-2']);
    expect(select.options[1].textContent).toContain('Kesh in a session');
  });

  it('con un solo vídeo el selector no se pinta: una lista de uno es ruido', async () => {
    mockedSegments.mockResolvedValue(new Map([['55', [segment()]]]));
    render(() => <Harness />);
    await openDock();

    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    expect(screen.queryByRole('combobox', { name: 'Video' })).toBeNull();
  });

  it('elegir en el selector fija el vídeo en la fila, no solo en la pantalla', async () => {
    twoVideos();
    render(() => <Harness />);
    await openDock();
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());

    fireEvent.change(screen.getByRole('combobox', { name: 'Video' }), {
      target: { value: 'm-2' },
    });

    await waitFor(() => expect(mockedSaveMedia).toHaveBeenCalledWith('row-a', 'm-2'));
  });

  it('el pin fija el vídeo que suena y se vuelve a pulsar para soltarlo', async () => {
    twoVideos();
    render(() => <Harness />);
    await openDock();
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Pin this video as preferred' }));
    await waitFor(() => expect(mockedSaveMedia).toHaveBeenCalledWith('row-a', 'm-1'));

    // Fijado: el mismo botón ahora suelta y la fila vuelve a «sin preferencia».
    const unpin = await screen.findByRole('button', { name: 'Unpin this video' });
    fireEvent.click(unpin);
    await waitFor(() => expect(mockedSaveMedia).toHaveBeenLastCalledWith('row-a', null));
  });

  it('un vídeo fijado que se cae no deja la tune muda y el panel lo dice', async () => {
    mockedSegments.mockResolvedValue(
      new Map([
        [
          '55',
          [
            segment({ mediaId: 'm-1', unavailable: true }),
            segment({ mediaId: 'm-2', title: 'Kesh in a session', position: 1 }),
          ],
        ],
      ])
    );
    render(() => (
      <Harness rows={[row({ preferredMedia: 'm-1' })]} />
    ));
    await openDock();

    // Suena el segundo (el primero está caído) y el aviso nombra el fijado.
    await waitFor(() => expect(document.querySelector('.player-dock__video iframe')).not.toBeNull());
    await waitFor(() =>
      expect(dock()!.textContent).toContain('pinned video unavailable')
    );
    const select = screen.getByRole('combobox', { name: 'Video' }) as HTMLSelectElement;
    expect(select.value).toBe('m-2');
    expect(select.options[0].disabled).toBe(true);
  });
});
