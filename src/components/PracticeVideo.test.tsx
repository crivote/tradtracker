// @vitest-environment jsdom
/**
 * El botón de vídeo de la lista de ensayo (#37), montado de verdad.
 *
 * Lo que solo se ve montando: sin segmentos no queda hueco ni marcador, una
 * entrada caída sale deshabilitada y **sin cargar la miniatura**, y el iframe
 * no existe hasta el clic — y aparece con `start` y **sin `end`** cuando el
 * segmento no declara fin, que es la trampa que rompe el reproductor.
 *
 * `vitest` corre sin `globals`: sin `afterEach(cleanup)` el DOM de una prueba se
 * cuela en la siguiente y `getByRole` encuentra dos botones (contaminación, no
 * un fallo del componente).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { PracticeVideo } from './PracticeVideo';
import type { TuneSegment } from '../lib/tradtube';

afterEach(cleanup);

function segment(overrides: Partial<TuneSegment> = {}): TuneSegment {
  return {
    originRef: '67',
    mediaId: '76312068',
    title: 'The Good Tune',
    youtubeId: 'e1-80u--A1o',
    startSec: 239,
    endSec: 264,
    position: 0,
    unavailable: false,
    ...overrides,
  };
}

describe('PracticeVideo', () => {
  it('sin segmentos no pinta nada: ni botón, ni miniatura, ni texto', () => {
    const { container } = render(() => <PracticeVideo segments={[]} />);

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('con segmentos pinta la miniatura perezosa del primero y la duración m:ss', () => {
    const { container, getByRole } = render(() => <PracticeVideo segments={[segment()]} />);

    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('https://i.ytimg.com/vi/e1-80u--A1o/mqdefault.jpg');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('width')).toBe('320');

    // 264 − 239 = 25 s
    expect(container.textContent).toContain('0:25');

    const button = getByRole('button');
    expect(button.getAttribute('title')).toBe('The Good Tune · 1 segment');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('el título del botón cuenta los segmentos disponibles', () => {
    const { getByRole } = render(() => (
      <PracticeVideo segments={[segment(), segment({ mediaId: 'b', youtubeId: 'fopTazmLTQA' })]} />
    ));

    expect(getByRole('button').getAttribute('title')).toBe('The Good Tune · 2 segments');
  });

  it('una entrada caída sale deshabilitada, dice unavailable y no carga la miniatura', () => {
    const { container, getByRole } = render(() => (
      <PracticeVideo segments={[segment({ unavailable: true, endSec: null })]} />
    ));

    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('unavailable');
    expect(container.querySelector('img')).toBeNull();

    // Deshabilitado de verdad: el clic no abre nada.
    fireEvent.click(button);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('al pulsar aparece el iframe con start y SIN end cuando end_sec es null', () => {
    const { container, getByRole } = render(() => (
      <PracticeVideo segments={[segment({ endSec: null })]} />
    ));

    expect(container.querySelector('iframe')).toBeNull();

    fireEvent.click(getByRole('button'));

    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    const src = frame.getAttribute('src') as string;
    expect(src).toContain('youtube-nocookie.com/embed/e1-80u--A1o');
    expect(src).toContain('start=239');
    expect(src).toContain('autoplay=1');
    expect(src).not.toContain('end=');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame.getAttribute('allow')).toBe('autoplay; encrypted-media');
  });

  it('con end_sec declarado el iframe lleva end=264', () => {
    const { container, getByRole } = render(() => <PracticeVideo segments={[segment()]} />);

    fireEvent.click(getByRole('button'));

    expect((container.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toContain(
      'end=264'
    );
  });

  it('el segundo clic cierra el reproductor', () => {
    const { container, getByRole } = render(() => <PracticeVideo segments={[segment()]} />);

    const button = getByRole('button');
    fireEvent.click(button);
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(button);
    expect(container.querySelector('iframe')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
