// @vitest-environment jsdom
/**
 * El selector de fondo (#31) montado de verdad: mosaico de nueve, etiquetas de
 * licencia y ratio, aviso de clave de Pexels y arrastre del encuadre hasta la
 * llamada que persiste. Supabase y la red van simulados — el cruce real está en
 * `image-search.integration.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

const saveImageChoice = vi.fn();
const clearImageChoice = vi.fn();
const searchCandidates = vi.fn();
const enlargeCommons = vi.fn();

vi.mock('../lib/repertoire', () => ({
  saveImageChoice: (...args: unknown[]) => saveImageChoice(...args),
  clearImageChoice: (...args: unknown[]) => clearImageChoice(...args),
}));

vi.mock('../lib/image-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image-search')>();
  return {
    ...actual,
    searchCandidates: (...args: unknown[]) => searchCandidates(...args),
    enlargeCommons: (...args: unknown[]) => enlargeCommons(...args),
  };
});

import BackgroundPicker from './BackgroundPicker';
import type { ImageCandidate } from '../lib/image-sources';

function candidate(n: number, extra: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    source: 'commons',
    id: `File-${n}.jpg`,
    title: `File-${n}.jpg`,
    thumbUrl: `https://upload.wikimedia.org/thumb/File-${n}.jpg/330px-File-${n}.jpg`,
    fullUrl: `https://upload.wikimedia.org/thumb/File-${n}.jpg/330px-File-${n}.jpg`,
    pageUrl: `https://commons.wikimedia.org/wiki/File:File-${n}.jpg`,
    author: `Author ${n}`,
    license: n === 0 ? 'Public domain' : 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    width: 1200,
    height: 800,
    term: 'filetype:bitmap Test',
    ...extra,
  };
}

/** Nueve candidatos: uno vertical, uno panorámico y siete cerca del 5:4. */
function nineCandidates(): ImageCandidate[] {
  const list = Array.from({ length: 9 }, (_, n) => candidate(n));
  list[1] = candidate(1, { width: 400, height: 800 });
  list[2] = candidate(2, { width: 2400, height: 800 });
  return list;
}

function renderPicker(overrides: { image?: any } = {}) {
  const onSaved = vi.fn();
  const view = render(() => (
    <BackgroundPicker
      repertoireId="row-a"
      title="The Butterfly"
      image={overrides.image ?? null}
      onSaved={onSaved}
    />
  ));
  return { ...view, onSaved };
}

beforeEach(() => {
  saveImageChoice.mockReset().mockResolvedValue(undefined);
  clearImageChoice.mockReset().mockResolvedValue(undefined);
  searchCandidates.mockReset().mockResolvedValue(nineCandidates());
  enlargeCommons.mockReset().mockImplementation(async (item: ImageCandidate) => item.fullUrl);
  // jsdom no mide: la caja del encuadre necesita un tamaño real para el arrastre.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 248,
    height: 198,
    top: 0,
    left: 0,
    right: 248,
    bottom: 198,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackgroundPicker', () => {
  it('abre el mosaico con nueve candidatos, licencia y etiqueta de ratio', async () => {
    renderPicker();

    fireEvent.click(screen.getByText('Choose background'));

    await waitFor(() => expect(screen.getByLabelText('Background candidates')).toBeTruthy());
    await waitFor(() => expect(searchCandidates).toHaveBeenCalled());

    const grid = screen.getByLabelText('Background candidates');
    await waitFor(() => expect(grid.querySelectorAll('button').length).toBe(9));

    // Licencia visible en todos: el verde es el de las libres.
    expect(screen.getAllByText('Public domain').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CC BY-SA 4.0').length).toBe(8);
    // Solo las imágenes que se alejan del 5:4 llevan etiqueta.
    expect(screen.getAllByText('vertical')).toHaveLength(1);
    expect(screen.getAllByText('panoramic')).toHaveLength(1);

    // Las palabras se prerrellenan sin artículo.
    const words = screen.getByLabelText('Words') as HTMLInputElement;
    expect(words.value).toBe('Butterfly');
    expect(searchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ words: 'Butterfly', source: 'commons' })
    );
  });

  it('elegir un candidato guarda la fila con el encuadre centrado', async () => {
    const { onSaved } = renderPicker();

    fireEvent.click(screen.getByText('Choose background'));
    const tiles = await waitFor(() => {
      const found = screen.getAllByTitle('Author 0 · File-0.jpg');
      expect(found.length).toBe(1);
      return found;
    });
    fireEvent.click(tiles[0]);

    await waitFor(() => expect(saveImageChoice).toHaveBeenCalledTimes(1));
    const [rowId, selection] = saveImageChoice.mock.calls[0];
    expect(rowId).toBe('row-a');
    expect(selection).toMatchObject({
      source: 'commons',
      id: 'File-0.jpg',
      focalX: 50,
      focalY: 50,
      zoom: 1,
    });
    // El grande se pidió al elegir, una sola vez.
    expect(enlargeCommons).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('arrastrar el recuadro mueve el focal y lo persiste al soltar', async () => {
    renderPicker();

    fireEvent.click(screen.getByText('Choose background'));
    const tile = await waitFor(() => {
      const found = screen.getAllByTitle('Author 0 · File-0.jpg');
      expect(found.length).toBe(1);
      return found;
    });
    fireEvent.click(tile[0]);

    const box = await waitFor(() => {
      const found = document.querySelector('[title="Drag to frame"]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });

    // 10 px a la derecha sobre un desborde de 49 (1200×800 en una caja 248×198).
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 110, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(box, { clientX: 110, clientY: 100, pointerId: 1 });

    await waitFor(() => expect(saveImageChoice).toHaveBeenCalledTimes(2));
    const [, moved] = saveImageChoice.mock.calls[1];
    // 50 − 10/49·100 = 29,59 → 30; el eje vertical no desborda y no se toca.
    expect(moved.focalX).toBe(30);
    expect(moved.focalY).toBe(50);
  });

  it('con un fondo ya guardado enseña el recuadro y el crédito con su licencia', async () => {
    renderPicker({
      image: {
        source: 'commons',
        id: 'File-0.jpg',
        thumbUrl: 'https://upload.wikimedia.org/thumb/File-0.jpg/330px-File-0.jpg',
        fullUrl: 'https://upload.wikimedia.org/thumb/File-0.jpg/960px-File-0.jpg',
        pageUrl: 'https://commons.wikimedia.org/wiki/File:File-0.jpg',
        author: 'Anon',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        focalX: 30,
        focalY: 70,
        zoom: 1.2,
        chosenAt: '2026-10-30T10:00:00Z',
      },
    });

    // La acción está ahí desde el principio y el crédito también.
    expect(screen.getByText('Choose background')).toBeTruthy();
    expect(screen.getByText(/Anon · CC BY-SA 4.0/)).toBeTruthy();

    fireEvent.click(screen.getByText('Choose background'));

    const box = await waitFor(() => {
      const found = document.querySelector('[title="Drag to frame"]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    // El encuadre guardado es el que se pinta: focal 30/70 y zoom 120 %.
    expect(box.style.backgroundPosition || '').toContain('30%');
    const slider = document.querySelector('#background-zoom') as HTMLInputElement;
    expect(slider.value).toBe('120');
  });

  it('Pexels sin clave pide la clave con su campo, no un error de red', async () => {
    renderPicker();

    fireEvent.click(screen.getByText('Choose background'));
    await waitFor(() => expect(searchCandidates).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Pexels'));

    await waitFor(() =>
      expect(screen.getByText(/Pexels needs your API key/)).toBeTruthy()
    );
    // No se ha ido a buscar sin clave.
    expect(searchCandidates).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Pexels key')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
