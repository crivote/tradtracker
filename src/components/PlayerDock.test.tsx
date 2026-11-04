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

import { startEngine, stopEngine } from '../lib/player-engine';
import { fetchSegments, type TuneSegment } from '../lib/tradtube';
import { resetPlayerForTests } from '../lib/player-store';
import type { RepertoireRow } from '../lib/repertoire-model';
import PlayTrigger from './PlayTrigger';
import { PlayerDock } from './PlayerDock';

const mockedStart = vi.mocked(startEngine);
const mockedStop = vi.mocked(stopEngine);
const mockedSegments = vi.mocked(fetchSegments);

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
    last_practiced_at: null,
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
