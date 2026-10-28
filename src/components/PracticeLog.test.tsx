// @vitest-environment jsdom
/**
 * El panel de registro de ensayo (#10, corte 1). La escritura se simula: lo que
 * se verifica aquí es el contrato del componente — qué manda a `logPractice`,
 * cuándo cierra, y que un fallo no se lleve por delante lo introducido.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

vi.mock('../lib/practice', () => ({ logPractice: vi.fn() }));

import { logPractice } from '../lib/practice';
import PracticeLog from './PracticeLog';

const mockedLog = vi.mocked(logPractice);

function renderPanel(onLogged: () => void | Promise<void> = vi.fn()) {
  render(() => <PracticeLog repertoireId="row-a" onLogged={onLogged} />);
  return onLogged;
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Practice now' }));
}

beforeEach(() => {
  mockedLog.mockReset();
});

// Sin `globals: true` la librería no limpia sola: sin esto el DOM de una prueba
// se cuela en la siguiente y `getByText` encuentra duplicados.
afterEach(() => cleanup());

describe('PracticeLog', () => {
  it('keeps the panel hidden until Practice now is pressed', () => {
    renderPanel();

    expect(screen.queryByText('Log a practice')).toBeNull();
    expect(screen.queryByPlaceholderText('Comment (optional)')).toBeNull();

    openPanel();

    expect(screen.getByText('Log a practice')).toBeTruthy();
    expect(screen.getByText('How did it go? (optional)')).toBeTruthy();
  });

  it('saves a practice with no quality and no comment as nulls', async () => {
    mockedLog.mockResolvedValue(undefined);
    renderPanel();
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() =>
      expect(mockedLog).toHaveBeenCalledWith('row-a', { quality: null, comment: null })
    );
  });

  it('sends the chosen quality and the trimmed comment', async () => {
    mockedLog.mockResolvedValue(undefined);
    renderPanel();
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(screen.getByRole('button', { name: '4' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.input(screen.getByPlaceholderText('Comment (optional)'), {
      target: { value: '  La B parte, más lenta  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() =>
      expect(mockedLog).toHaveBeenCalledWith('row-a', {
        quality: 4,
        comment: 'La B parte, más lenta',
      })
    );
  });

  it('calls onLogged and closes the panel after saving', async () => {
    mockedLog.mockResolvedValue(undefined);
    const onLogged = vi.fn();
    renderPanel(onLogged);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Log a practice')).toBeNull();
    // Cerrado y limpio: al reabrirlo no queda ni la calidad ni el comentario.
    expect(screen.getByRole('button', { name: 'Practice now' })).toBeTruthy();
  });

  it('shows the real error and keeps the panel open with what was typed', async () => {
    mockedLog.mockRejectedValue(new Error('Could not save the practice: boom'));
    const onLogged = vi.fn();
    renderPanel(onLogged);
    openPanel();

    fireEvent.input(screen.getByPlaceholderText('Comment (optional)'), {
      target: { value: 'Nota que no se puede perder' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    expect(screen.getByText('Log a practice')).toBeTruthy();
    expect(
      (screen.getByPlaceholderText('Comment (optional)') as HTMLTextAreaElement).value
    ).toBe('Nota que no se puede perder');
    expect(onLogged).not.toHaveBeenCalled();
  });
});
