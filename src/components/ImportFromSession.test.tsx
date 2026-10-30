// @vitest-environment jsdom
/**
 * Panel del import del tunebook (#32, corte 2).
 *
 * Lo que se prueba aquí es el cableado de la pantalla: la red del API y la
 * escritura en Supabase van simuladas (`importSessionTunes` es del adaptador,
 * que se ejercita contra la base real). El cálculo de qué falta
 * (`importPlan`, `parseMemberId`) se deja **real**: es puro y probarlo contra un
 * doble diría menos.
 *
 * `afterEach(cleanup)` no es opcional: vitest corre sin `globals` y el DOM de una
 * prueba se cuela en la siguiente («Found multiple elements»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

vi.mock('../lib/thesession-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/thesession-api')>();
  return {
    ...actual,
    fetchTunebook: vi.fn(),
    searchMembers: vi.fn(),
  };
});

vi.mock('../lib/repertoire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/repertoire')>();
  return { ...actual, importSessionTunes: vi.fn() };
});

import { importSessionTunes } from '../lib/repertoire';
import { SessionImportError, fetchTunebook, searchMembers } from '../lib/thesession-api';
import type { SessionMember, SessionTune } from '../lib/thesession-import';
import ImportFromSession from './ImportFromSession';

const mockedTunebook = vi.mocked(fetchTunebook);
const mockedSearch = vi.mocked(searchMembers);
const mockedImport = vi.mocked(importSessionTunes);

const TUNES: SessionTune[] = [
  { tuneId: 11, name: 'Morning Dew', rhythm: 'reel', addedAt: '2026-01-02T10:00:00Z' },
  { tuneId: 22, name: 'Cooley’s Reel', rhythm: 'reel', addedAt: null },
  { tuneId: 33, name: 'Drowsy Maggie', rhythm: 'reel', addedAt: null },
];

const MEMBERS: SessionMember[] = [
  { id: 99727, name: 'victor gomez', bio: 'Fiddler in Madrid. Plays reels and jigs.' },
  { id: 4242, name: 'victor hugo', bio: null },
];

function renderPanel(existingRefs: Set<string> = new Set()) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  const view = render(() => (
    <ImportFromSession
      existingRefs={existingRefs}
      onImported={onImported}
      onClose={onClose}
    />
  ));
  return { onImported, onClose, ...view };
}

function typeMember(value: string) {
  fireEvent.input(screen.getByLabelText(/Your The Session profile/), {
    target: { value },
  });
}

beforeEach(() => {
  mockedTunebook.mockReset();
  mockedSearch.mockReset();
  mockedImport.mockReset();
  mockedTunebook.mockResolvedValue(TUNES);
  mockedImport.mockResolvedValue({
    createdTunes: 2,
    added: 2,
    alreadyPresent: 0,
    status: 'playing_along',
  });
});

afterEach(() => cleanup());

describe('import del tunebook de The Session (#32)', () => {
  it('un id numérico va directo al tunebook y pinta el resumen', async () => {
    renderPanel(new Set(['22']));

    typeMember('99727');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(mockedTunebook).toHaveBeenCalledTimes(1));
    expect(mockedTunebook.mock.calls[0][0]).toBe(99727);
    // Un id no pasa por el buscador de miembros.
    expect(mockedSearch).not.toHaveBeenCalled();

    await waitFor(() => expect(document.querySelector('.import .summary')).toBeTruthy());
    const summary = document.querySelector('.import .summary')!.textContent!;
    expect(summary).toContain('3 tunes found');
    expect(summary).toContain('1 already in your repertoire');
    expect(summary).toContain('2 to add');
  });

  it('un nombre pasa por el buscador y ofrece los candidatos con su bio', async () => {
    mockedSearch.mockResolvedValue(MEMBERS);
    renderPanel();

    typeMember('victor');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith('victor'));
    expect(mockedTunebook).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText('victor gomez')).toBeTruthy());
    expect(screen.getByText(/Fiddler in Madrid/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'This one' }).length).toBe(2);

    // Elegir un candidato es lo que pide el tunebook, con su id.
    fireEvent.click(screen.getAllByRole('button', { name: 'This one' })[0]);
    await waitFor(() => expect(mockedTunebook).toHaveBeenCalledWith(99727, expect.any(Function)));
  });

  it('sin coincidencias lo dice en vez de quedarse mudo', async () => {
    mockedSearch.mockResolvedValue([]);
    renderPanel();

    typeMember('nadie');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No member matches that name.'));
  });

  it('si ya están todos, deshabilita el alta', async () => {
    renderPanel(new Set(['11', '22', '33']));

    typeMember('https://thesession.org/members/99727');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(mockedTunebook).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Nothing to import.')).toBeTruthy();

    const button = screen.getByRole('button', { name: /^Import 0 tunes$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('una cuenta borrada se lee como tal, no como un fallo de red', async () => {
    mockedTunebook.mockRejectedValue(
      new SessionImportError('That member no longer exists', 'gone', 410)
    );
    renderPanel();

    typeMember('999999');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'That member no longer exists on The Session.'
      )
    );
  });

  it('el alta llama a importSessionTunes con playing_along y recarga la home', async () => {
    const { onImported } = renderPanel();

    typeMember('99727');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    const importButton = (await waitFor(() =>
      screen.getByRole('button', { name: 'Import 3 tunes' })
    )) as HTMLButtonElement;
    fireEvent.click(importButton);

    await waitFor(() => expect(mockedImport).toHaveBeenCalledTimes(1));
    const [tunes, status] = mockedImport.mock.calls[0];
    expect(tunes.map((tune) => tune.tuneId)).toEqual([11, 22, 33]);
    // El peldaño por defecto: el tunebook no dice nivel, y sin elegirlo la home
    // perdería su significado con 400 tunes en una sola banda.
    expect(status).toBe('playing_along');

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    // El resultado se queda dentro del panel: no se cierra solo.
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 tunes added'));
  });

  it('el error real del alta se queda en el panel, con el peldaño elegido intacto', async () => {
    mockedImport.mockRejectedValue(new Error('Could not add the tunes: boom'));
    renderPanel();

    typeMember('99727');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    const importButton = (await waitFor(() =>
      screen.getByRole('button', { name: 'Import 3 tunes' })
    )) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText('Add them as'), {
      target: { value: 'solo_ready' },
    });
    expect(screen.getByText(/If someone asks for a tune/)).toBeTruthy();

    fireEvent.click(importButton);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not add the tunes: boom')
    );
    expect(mockedImport.mock.calls[0][1]).toBe('solo_ready');
  });

  it('Close llama a onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
