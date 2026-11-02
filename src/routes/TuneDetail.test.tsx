// @vitest-environment jsdom
/**
 * La vista del detalle nunca se había ejecutado: el corte la verificó con tipos,
 * tests del modelo puro y una navegación que el guard manda a `/login`. Esta
 * suite monta el componente de verdad con el router de memoria y el acceso a
 * Supabase simulado, que es el único tramo que los tests puros no cruzan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';

vi.mock('../lib/repertoire', () => ({
  fetchRepertoireRow: vi.fn(),
  removeFromRepertoire: vi.fn(),
  saveStatus: vi.fn(),
  saveShelved: vi.fn(),
  saveOverrides: vi.fn(),
}));

import {
  fetchRepertoireRow,
  saveOverrides,
  saveShelved,
  saveStatus,
} from '../lib/repertoire';
import TuneDetail from './TuneDetail';

const mockedFetch = vi.mocked(fetchRepertoireRow);
const mockedSaveStatus = vi.mocked(saveStatus);
const mockedSaveShelved = vi.mocked(saveShelved);
const mockedSaveOverrides = vi.mocked(saveOverrides);

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'row-a',
    status: 'learning',
    shelved: false,
    rating: 4,
    custom_title: null,
    custom_rhythm: null,
    custom_key: null,
    notes: 'La B parte se me cruza con Cooley’s.\nSegunda línea.',
    added_at: '2026-10-01T10:00:00Z',
    last_practiced_at: null,
    tune: {
      id: 'tune-a',
      origin: 'thesession',
      origin_ref: '55',
      name: 'Kesh, The',
      rhythm: 'jig',
      meter: '6/8',
      key: null,
      abc: null,
    },
    ...overrides,
  };
}

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  const view = render(() => (
    <MemoryRouter history={history}>
      <Route path="/repertoire/:id" component={TuneDetail} />
      <Route path="/" component={() => <p>repertoire list</p>} />
    </MemoryRouter>
  ));
  return { history, ...view };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedSaveStatus.mockReset();
  mockedSaveShelved.mockReset();
  mockedSaveOverrides.mockReset();
});

// Sin `globals: true` en vitest, la librería no registra su limpieza sola: sin
// esto el DOM de una prueba se cuela en la siguiente y `getByText` encuentra
// duplicados que no existen en la app.
afterEach(() => cleanup());

describe('TuneDetail', () => {
  it('renders the tune it was asked for, with the pure model applied', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);

    renderAt('/repertoire/row-a');

    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());
    expect(mockedFetch).toHaveBeenCalledWith('row-a');
    // El artículo invertido se muestra delante y las iniciales salen del título mostrado.
    expect(screen.getByText('TK')).toBeTruthy();
    expect(screen.getByText('jig')).toBeTruthy();
    expect(screen.getByText('6/8')).toBeTruthy();
    expect(screen.getByText('Learning')).toBeTruthy();
    // Nunca ensayada: la etiqueta es determinista, no depende del reloj.
    expect(screen.getByText('Never practiced')).toBeTruthy();
    // Las notas se pintan tal cual, con sus saltos de línea.
    expect(screen.getByText(/La B parte se me cruza/)).toBeTruthy();
  });

  it('links to TheSession by origin_ref and marks a custom key as an override', async () => {
    mockedFetch.mockResolvedValue(makeRow({ custom_key: 'G' }) as any);

    renderAt('/repertoire/row-a');

    await waitFor(() => expect(screen.getByText('G')).toBeTruthy());
    const link = screen.getByText('Open on TheSession') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://thesession.org/tunes/55');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    // Un valor propio lleva su marca de override junto a la etiqueta.
    expect(screen.getAllByTitle('Custom value').length).toBeGreaterThan(0);
  });

  it('says the tune is not in the repertoire when the query comes back empty', async () => {
    mockedFetch.mockResolvedValue(null);

    renderAt('/repertoire/missing');

    await waitFor(() =>
      expect(screen.getByText('That tune is not in your repertoire.')).toBeTruthy()
    );
    // No hay enlace externo: no hay tune.
    expect(screen.queryByText('Open on TheSession')).toBeNull();
  });

  it('shows the real error and does NOT claim the tune is missing', async () => {
    mockedFetch.mockRejectedValue(new Error('Could not load that tune: boom'));

    renderAt('/repertoire/row-a');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    expect(screen.queryByText('That tune is not in your repertoire.')).toBeNull();
  });

  it('reloads when the route changes to another id', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);

    const { history } = renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());

    mockedFetch.mockResolvedValue(
      makeRow({
        id: 'row-b',
        tune: {
          id: 'tune-b',
          origin: 'thesession',
          origin_ref: '2',
          name: 'Bucks Of Oranmore, The',
          rhythm: 'reel',
          meter: '4/4',
          key: null,
          abc: null,
        },
      }) as any
    );

    history.set({ value: '/repertoire/row-b' });

    await waitFor(() => expect(screen.getByText('The Bucks Of Oranmore')).toBeTruthy());
    expect(mockedFetch).toHaveBeenLastCalledWith('row-b');
  });

  /**
   * #11: el peldaño se escribe desde el detalle. Se comprueba la llamada al
   * adaptador y la recarga, no el estado de la base —eso lo cruza la integración
   * opt-in—. El `select` se busca por su etiqueta accesible, que es como lo usa
   * quien navega con teclado.
   */
  it('writes the chosen level through saveStatus and reloads the row', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveStatus.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByLabelText('Level')).toBeTruthy());

    const select = screen.getByLabelText('Level') as HTMLSelectElement;
    expect(select.value).toBe('learning');
    // Las cinco etiquetas canónicas, en orden de escalera.
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'To learn',
      'Learning',
      'Shaky',
      'Playing along',
      'Solo-ready',
    ]);
    // La definición del peldaño actual sale de BANDS, no se reescribe aquí.
    expect(screen.getByText('Know the parts, but can’t get through it end to end.')).toBeTruthy();

    fireEvent.change(select, { target: { value: 'solo_ready' } });

    await waitFor(() => expect(mockedSaveStatus).toHaveBeenCalledWith('row-a', 'solo_ready'));
    // Guardar no basta: la fila se relee, como con el fondo y los ensayos.
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  });

  it('writes the shelved flag through saveShelved without touching the level', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveShelved.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByLabelText('Shelved — out of rotation')).toBeTruthy());

    const checkbox = screen.getByLabelText('Shelved — out of rotation') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() => expect(mockedSaveShelved).toHaveBeenCalledWith('row-a', true));
    // Aparcar no es un peldaño: el adaptador del nivel no se toca.
    expect(mockedSaveStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  });

  it('shows the help line and the checked box when the tune is already shelved', async () => {
    mockedFetch.mockResolvedValue(makeRow({ shelved: true }) as any);

    renderAt('/repertoire/row-a');
    await waitFor(() =>
      expect(screen.getByLabelText('Shelved — out of rotation')).toBeTruthy()
    );

    expect((screen.getByLabelText('Shelved — out of rotation') as HTMLInputElement).checked).toBe(
      true
    );
    expect(
      screen.getByText('Keeps its level (Learning) and stays out of rotation.')
    ).toBeTruthy();
  });

  it('shows the write error in the existing alert instead of losing the change', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveStatus.mockRejectedValue(new Error('Could not save the level: that tune is not yours.'));

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByLabelText('Level')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'to_learn' } });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('that tune is not yours')
    );
  });

  /* ── Formulario de overrides (F2, #8) ─────────────────────────────── */

  /**
   * El contrato con el adaptador es lo que se comprueba aquí; que la fila se
   * escriba de verdad lo cruza la integración opt-in. El estándar se enseña como
   * placeholder: un campo vacío significa «usar el del catálogo».
   */
  it('opens the details form with the standard value as a placeholder, never as a draft', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());

    const trigger = screen.getByRole('button', { name: 'Edit details' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Title')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const title = screen.getByLabelText('Title') as HTMLInputElement;
    const rhythm = screen.getByLabelText('Rhythm') as HTMLInputElement;
    const key = screen.getByLabelText('Key') as HTMLInputElement;
    const abc = screen.getByLabelText('ABC') as HTMLTextAreaElement;

    expect(title.placeholder).toBe('Kesh, The');
    expect(rhythm.placeholder).toBe('jig');
    // Sin tonalidad en el catálogo el hueco se enseña como hueco.
    expect(key.placeholder).toBe('');
    expect(abc.placeholder).toBe('');
    expect([title.value, rhythm.value, key.value, abc.value]).toEqual(['', '', '', '']);

    // Sin cambios no hay nada que guardar y nada que revertir.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryAllByRole('button', { name: /^Use standard/ })).toHaveLength(0);
  });

  it('saves only the changed field, trimmed, and repaints the row without asking Supabase again', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveOverrides.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

    fireEvent.input(screen.getByLabelText('Title'), {
      target: { value: '  The Kesh (session)  ' },
    });

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(mockedSaveOverrides).toHaveBeenCalledWith('row-a', { title: 'The Kesh (session)' })
    );
    // Un solo envío: los otros tres campos no se reescriben.
    expect(mockedSaveOverrides).toHaveBeenCalledTimes(1);

    // La fila ya cargada se repinta con lo nuevo: el `*` aparece y no se pide nada.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('The Kesh (session)')
    );
    expect(screen.queryAllByTitle('Custom value').length).toBeGreaterThan(0);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    // Guardado: el borrador ya coincide con lo guardado y el botón se apaga.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    );
  });

  it('reverts one field to the standard by writing null, and the marker goes with it', async () => {
    mockedFetch.mockResolvedValue(makeRow({ custom_key: 'G' }) as any);
    mockedSaveOverrides.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('G')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    // Un campo sobreescrito arranca con su valor, no con el estándar.
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('G');

    fireEvent.click(screen.getByRole('button', { name: 'Use standard key' }));

    await waitFor(() => expect(mockedSaveOverrides).toHaveBeenCalledWith('row-a', { key: null }));
    await waitFor(() => expect(screen.queryAllByTitle('Custom value')).toHaveLength(0));
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  /**
   * Las dos costuras del formulario, que el corte no veía: resiembra y
   * normalización. Sin estas pruebas, «Use standard» se lleva por delante lo que
   * el usuario tenga a medio escribir en otro campo, y un valor con espacios deja
   * el «Save» armado para siempre reescribiendo lo mismo.
   */
  it('keeps what was typed in one field when another is reverted', async () => {
    mockedFetch.mockResolvedValue(makeRow({ custom_key: 'G' }) as any);
    mockedSaveOverrides.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('G')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

    fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'The Kesh Reel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use standard key' }));

    await waitFor(() => expect(mockedSaveOverrides).toHaveBeenCalledWith('row-a', { key: null }));
    // Lo tecleado en el título sigue ahí: revertir un campo no resiembra el resto.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('The Kesh Reel');
  });

  it('normalizes the draft after saving, so Save does not stay armed', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveOverrides.mockResolvedValue(undefined);

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

    fireEvent.input(screen.getByLabelText('Title'), { target: { value: '   Kesh   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedSaveOverrides).toHaveBeenCalledWith('row-a', { title: 'Kesh' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Kesh')
    );
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a failed override write in red and keeps the draft', async () => {
    mockedFetch.mockResolvedValue(makeRow() as any);
    mockedSaveOverrides.mockRejectedValue(
      new Error('Could not save the details: that tune is not yours.')
    );

    renderAt('/repertoire/row-a');
    await waitFor(() => expect(screen.getByText('The Kesh')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.input(screen.getByLabelText('Rhythm'), { target: { value: 'slide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('that tune is not yours')
    );
    // El borrador no se pierde: lo escrito sigue en el campo para reintentar.
    expect((screen.getByLabelText('Rhythm') as HTMLInputElement).value).toBe('slide');
    // Y la fila no se toca: la marca de override no aparece de la nada.
    expect(screen.queryAllByTitle('Custom value')).toHaveLength(0);
  });
});
