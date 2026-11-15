import { describe, expect, it } from 'vitest';
import { completeAbc, pickVersion, splitSettings } from './abc-settings';

/**
 * Lo puro de las versiones de ABC (#59): qué es un setting, de dónde sale su
 * identidad y cómo se completa un cuerpo que llegó sin cabeceras.
 */

describe('splitSettings', () => {
  it('el id de una versión es el de setting de TheSession, no su posición', () => {
    const abc = [
      'X: 1',
      'T: Cooley’s',
      'S: https://thesession.org/tunes/1#setting12342',
      'R: reel',
      'M:4/4',
      'L:1/8',
      'K: Edor',
      '|:D2|EBBA B2 EB|',
      '',
      'X: 2',
      'T: Cooley’s',
      'S: https://thesession.org/tunes/1#setting4521',
      'R: reel',
      'M:4/4',
      'L:1/8',
      'K: Emin',
      '|:F|CGGC G2 CG|',
    ].join('\n');

    const versions = splitSettings(abc);

    expect(versions.map((version) => version.id)).toEqual(['setting12342', 'setting4521']);
    // El rótulo es número + tonalidad: lo que distingue dos versiones de un vistazo.
    expect(versions[0].label).toBe('1 · Edor');
    expect(versions[1].label).toBe('2 · Emin');
  });

  it('sin `S:` la identidad cae al índice y no se inventa un id', () => {
    const versions = splitSettings('X:1\nT:A\nM:4/4\nL:1/8\nK:D\n|DEFG|\n');
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe('n1');
  });

  it('completa un cuerpo sin cabeceras con los metadatos de la fila', () => {
    const versions = splitSettings('L: 1/8\n     K:Adorian\n     |:B|A3B A2GE|', {
      title: 'The Abbey',
      rhythm: 'reel',
      meter: '4/4',
    });

    expect(versions).toHaveLength(1);
    const abc = versions[0].abc;
    expect(abc).toContain('X: 1');
    expect(abc).toContain('T: The Abbey');
    expect(abc).toContain('R: reel');
    expect(abc).toContain('M: 4/4');
    expect(abc).toContain('K: Adorian');
    // La indentación del original no llega al ABC que se le pasa a abcjs.
    expect(abc).not.toContain('     K:');
  });

  it('no duplica la tonalidad: el `K:` del cuerpo manda sobre el de la fila', () => {
    const abc = completeAbc('L:1/8\nK:G\n|GABc|', { key: 'D', title: 'X' });
    expect(abc!.match(/^K:/gm)).toHaveLength(1);
    expect(abc).toContain('K: G');
  });

  it('un cuerpo sin tonalidad no es reproducirle: se dice que no hay', () => {
    expect(completeAbc('|DEFG|', { title: 'X' })).toBeNull();
  });

  it('el HTML de una página de error no se envuelve como si fuera música', () => {
    expect(splitSettings('<html>not abc</html>', { key: 'D' })).toEqual([]);
  });
});

describe('pickVersion', () => {
  const versions = [
    { id: 'setting1', label: '1 · G', abc: 'X:1\nK:G\n|GAB|' },
    { id: 'setting2', label: '2 · D', abc: 'X:2\nK:D\n|DEF|' },
  ];

  it('sin preferencia suena la primera', () => {
    expect(pickVersion(versions, null)?.id).toBe('setting1');
  });

  it('con preferencia suena esa', () => {
    expect(pickVersion(versions, 'setting2')?.id).toBe('setting2');
  });

  it('una preferencia desaparecida no rompe: se cae a la primera', () => {
    expect(pickVersion(versions, 'setting999')?.id).toBe('setting1');
  });

  it('sin versiones no hay nada que elegir', () => {
    expect(pickVersion([], 'setting1')).toBeNull();
  });
});
