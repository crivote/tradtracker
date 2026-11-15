/**
 * El enlace de vuelta de la ficha: la pantalla de origen viaja en `?from=` y se
 * resuelve a una ruta interna conocida. Lo que no se reconoce —o lo que apunta
 * fuera de la app— cae a la home, que es el único destino que siempre existe.
 */
import { describe, expect, it } from 'vitest';
import { tuneHref, resolveBackTarget } from './tune-back';

describe('resolveBackTarget', () => {
  it('falls back to the repertoire when there is no origin', () => {
    expect(resolveBackTarget(null)).toEqual({ href: '/', label: 'Back to repertoire' });
    expect(resolveBackTarget(undefined)).toEqual({ href: '/', label: 'Back to repertoire' });
    expect(resolveBackTarget('')).toEqual({ href: '/', label: 'Back to repertoire' });
  });

  it('returns to the home with its query', () => {
    expect(resolveBackTarget('/')).toEqual({ href: '/', label: 'Back to repertoire' });
  });

  it('names each level list by its heading', () => {
    expect(resolveBackTarget('/level/all')).toEqual({
      href: '/level/all',
      label: 'Back to all tunes',
    });
    expect(resolveBackTarget('/level/to_learn')).toEqual({
      href: '/level/to_learn',
      label: 'Back to the backlog',
    });
    expect(resolveBackTarget('/level/shelved')).toEqual({
      href: '/level/shelved',
      label: 'Back to shelved',
    });
    expect(resolveBackTarget('/level/playing_along')).toEqual({
      href: '/level/playing_along',
      label: 'Back to playing along',
    });
    expect(resolveBackTarget('/level/solo_ready').label).toBe('Back to solo-ready');
  });

  it('keeps the filter of the list it came from', () => {
    expect(resolveBackTarget('/level/all?q=cooley&sort=title')).toEqual({
      href: '/level/all?q=cooley&sort=title',
      label: 'Back to all tunes',
    });
    expect(resolveBackTarget('/history?range=7').href).toBe('/history?range=7');
    expect(resolveBackTarget('/search?q=jig').label).toBe('Back to search');
  });

  it('sends the learning level to its own screen, which the list only redirects to', () => {
    expect(resolveBackTarget('/level/learning')).toEqual({
      href: '/learning',
      label: 'Back to learning',
    });
  });

  it('names the other screens by their headings', () => {
    expect(resolveBackTarget('/practice')).toEqual({
      href: '/practice',
      label: 'Back to practice list',
    });
    expect(resolveBackTarget('/history')).toEqual({
      href: '/history',
      label: 'Back to practice history',
    });
  });

  it('ignores trailing slashes, which the router tolerates', () => {
    expect(resolveBackTarget('/level/all/')).toEqual({
      href: '/level/all',
      label: 'Back to all tunes',
    });
  });

  it('never returns an unknown route, an external URL or a script', () => {
    for (const raw of [
      '/level/nonsense',
      '/repertoire/other-id',
      '/settings',
      'https://evil.example/level/all',
      '//evil.example/level/all',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(resolveBackTarget(raw)).toEqual({ href: '/', label: 'Back to repertoire' });
    }
  });
});

describe('tuneHref', () => {
  it('leaves the home URL clean: its back link already points there', () => {
    expect(tuneHref('row-a')).toBe('/repertoire/row-a');
    expect(tuneHref('row-a', '/')).toBe('/repertoire/row-a');
  });

  it('carries the list and its filter, encoded', () => {
    expect(tuneHref('row-a', '/level/all?q=cooley')).toBe(
      '/repertoire/row-a?from=%2Flevel%2Fall%3Fq%3Dcooley'
    );
  });

  it('round-trips through the resolver', () => {
    const origin = '/level/shaky?q=pipe';
    const raw = new URL(tuneHref('row-a', origin), 'http://tuneshed.invalid').searchParams.get('from');
    expect(resolveBackTarget(raw)).toEqual({ href: origin, label: 'Back to shaky' });
  });
});
