// @vitest-environment jsdom
/**
 * El popup de registro de ensayo, que sustituye al panel en línea que solo vivía
 * en la ficha.
 *
 * Se simula la escritura: lo que se comprueba es el contrato del componente —
 * qué manda a `logPractice`, qué opciones lleva cuando viene de la lista del día,
 * que cerrar cancela de verdad, y que un fallo de red no se lleva por delante lo
 * tecleado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

vi.mock('../lib/practice', () => ({ logPractice: vi.fn() }));

import { logPractice } from '../lib/practice';
import { PracticeMarkButton, PracticeMarkHost } from './PracticeMark';
import { closePractice } from '../lib/practice-mark';

const mockedLog = vi.mocked(logPractice);

function renderMark(options: { onLogged?: (sessionId: string) => void; sessionId?: string; position?: number } = {}) {
  const onLogged = options.onLogged ?? vi.fn();
  render(() => (
    <>
      <PracticeMarkButton
        target={{
          repertoireId: 'row-a',
          title: 'The Morning Dew',
          sessionId: options.sessionId,
          position: options.position,
        }}
        onLogged={onLogged}
      />
      <PracticeMarkHost />
    </>
  ));
  return onLogged;
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Practice now' }));
const dialog = () => screen.getByRole('dialog');

beforeEach(() => {
  mockedLog.mockReset();
  mockedLog.mockResolvedValue('session-1');
});

afterEach(() => {
  cleanup();
  closePractice();
});

describe('PracticeMark', () => {
  it('no pinta nada hasta que se invoca', () => {
    renderMark();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Practice now' })).toBeTruthy();
  });

  it('abre un diálogo con el título de la tune y las cinco estrellas', () => {
    renderMark();
    openDialog();

    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('The Morning Dew');
    expect(dialog().textContent).toContain('Log a practice');
    for (const value of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${value} of 5`) })).toBeTruthy();
    }
    // Sin puntuar se dice con una palabra, no con cinco estrellas vacías.
    expect(dialog().textContent).toContain('Optional');
  });

  it('guarda la valoración y la nota, avisa a la vista y cierra', async () => {
    const onLogged = renderMark();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: '4 of 5 — Good' }));
    expect(screen.getByRole('button', { name: '4 of 5 — Good' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(dialog().textContent).toContain('Good');

    fireEvent.input(screen.getByLabelText('Practice note'), {
      target: { value: '  La B parte, más lenta  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() =>
      expect(mockedLog).toHaveBeenCalledWith(
        'row-a',
        { quality: 4, comment: '  La B parte, más lenta  ' },
        { sessionId: null, position: undefined },
      ),
    );
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith('session-1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('registrar sin puntuar sigue siendo posible: calidad nula y nota vacía', async () => {
    renderMark();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() =>
      expect(mockedLog).toHaveBeenCalledWith(
        'row-a',
        // La nota vacía viaja tal cual: quien la convierte en `null` es
        // `logPractice`, que es donde se decide qué se guarda.
        { quality: null, comment: '' },
        { sessionId: null, position: undefined },
      ),
    );
  });

  it('volver a pulsar la estrella elegida la deja en blanco', async () => {
    renderMark();
    openDialog();

    const four = screen.getByRole('button', { name: '4 of 5 — Good' });
    fireEvent.click(four);
    fireEvent.click(four);
    expect(four.getAttribute('aria-pressed')).toBe('false');
    expect(dialog().textContent).toContain('Optional');
  });

  it('con la sesión de la lista abierta, valora sobre esa sesión y en su posición', async () => {
    renderMark({ sessionId: 'open-session', position: 3 });
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: '5 of 5 — Strong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() =>
      expect(mockedLog).toHaveBeenCalledWith(
        'row-a',
        { quality: 5, comment: '' },
        { sessionId: 'open-session', position: 3 },
      ),
    );
  });

  it('cancelar no escribe nada y cierra', () => {
    renderMark();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockedLog).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape cierra el diálogo', () => {
    renderMark();
    openDialog();

    fireEvent.keyDown(dialog(), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedLog).not.toHaveBeenCalled();
  });

  it('un fallo se queda dentro y no se lleva por delante la nota', async () => {
    mockedLog.mockRejectedValue(new Error('Could not save the practice: boom'));
    const onLogged = renderMark();
    openDialog();

    fireEvent.input(screen.getByLabelText('Practice note'), {
      target: { value: 'Nota que no se puede perder' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save practice' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
    expect(dialog().textContent).toContain('The Morning Dew');
    expect((screen.getByLabelText('Practice note') as HTMLTextAreaElement).value).toBe(
      'Nota que no se puede perder',
    );
    expect(onLogged).not.toHaveBeenCalled();
  });
});
