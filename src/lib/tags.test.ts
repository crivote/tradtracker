/**
 * Modelo puro del vocabulario (F17, #48). Lo que se prueba aquí es lo que la
 * pantalla no puede permitirse: que un hijo no se promocione a raíz, que el orden
 * no dependa de cómo llegaron las filas y que expandir no devuelva padres ni
 * duplicados. Todo con datos a mano: la base ya está aplicada y no se toca.
 */
import { describe, expect, it } from 'vitest';
import { filterBySelectedTags, expandTagIds, facetTree, tagsForTune, type Tag, type TagFacetInfo } from './tags';

const FACETS: TagFacetInfo[] = [
  { id: 'mood', label: 'Mood', sort: 3 },
  { id: 'tradition', label: 'Tradition', sort: 1 },
  { id: 'technique', label: 'Technique', sort: 2 },
];

const TAGS: Tag[] = [
  // Deliberadamente desordenadas y con un huérfano en medio.
  { id: 3, facet: 'tradition', value: 'donegal', label: 'Donegal', parent: 1, sort: 11 },
  { id: 1, facet: 'tradition', value: 'ireland', label: 'Ireland', parent: null, sort: 1 },
  { id: 5, facet: 'tradition', value: 'shetland', label: 'Shetland', parent: 2, sort: 17 },
  { id: 30, facet: 'tradition', value: 'atlantis', label: 'Atlantis', parent: 999, sort: 3 },
  { id: 2, facet: 'tradition', value: 'scotland', label: 'Scotland', parent: null, sort: 2 },
  { id: 4, facet: 'tradition', value: 'sliabh_luchra', label: 'Sliabh Luachra', parent: 1, sort: 12 },
  { id: 11, facet: 'technique', value: 'cuts', label: 'Cuts', parent: null, sort: 8 },
  { id: 10, facet: 'technique', value: 'rolls', label: 'Rolls', parent: null, sort: 6 },
  { id: 20, facet: 'mood', value: 'melancholy', label: 'Melancholy', parent: null, sort: 1 },
];

describe('facetTree', () => {
  it('puts the facets in sort order and hangs each child under its parent', () => {
    const groups = facetTree(FACETS, TAGS);

    expect(groups.map((group) => group.facet.label)).toEqual(['Tradition', 'Technique', 'Mood']);

    const tradition = groups[0];
    // Raíces en orden de `sort`; el huérfano no se promociona a raíz.
    expect(tradition.nodes.map((node) => node.tag.label)).toEqual(['Ireland', 'Scotland']);
    expect(tradition.nodes[0].children.map((tag) => tag.label)).toEqual([
      'Donegal',
      'Sliabh Luachra',
    ]);
    expect(tradition.nodes[1].children.map((tag) => tag.label)).toEqual(['Shetland']);

    // Una faceta sin hijos deja las raíces con la lista vacía, no con `undefined`.
    const technique = groups[1];
    expect(technique.nodes.map((node) => node.tag.label)).toEqual(['Rolls', 'Cuts']);
    expect(technique.nodes.every((node) => node.children.length === 0)).toBe(true);
  });

  it('discards a child whose parent does not exist instead of promoting it', () => {
    const groups = facetTree(FACETS, TAGS);
    const labels = groups.flatMap((group) =>
      group.nodes.flatMap((node) => [node.tag.label, ...node.children.map((tag) => tag.label)])
    );

    expect(labels).not.toContain('Atlantis');
  });

  it('breaks ties on sort by id, never by arrival order', () => {
    const tags: Tag[] = [
      { id: 8, facet: 'mood', value: 'b', label: 'B', parent: null, sort: 5 },
      { id: 7, facet: 'mood', value: 'a', label: 'A', parent: null, sort: 5 },
    ];

    const groups = facetTree([{ id: 'mood', label: 'Mood', sort: 1 }], tags);

    expect(groups[0].nodes.map((node) => node.tag.id)).toEqual([7, 8]);
  });

  it('drops a grandchild: the tree is one level deep', () => {
    const tags: Tag[] = [
      { id: 1, facet: 'tradition', value: 'ireland', label: 'Ireland', parent: null, sort: 1 },
      { id: 2, facet: 'tradition', value: 'donegal', label: 'Donegal', parent: 1, sort: 2 },
      { id: 3, facet: 'tradition', value: 'gleann', label: 'Gleann', parent: 2, sort: 3 },
    ];

    const groups = facetTree([{ id: 'tradition', label: 'Tradition', sort: 1 }], tags);

    expect(groups[0].nodes).toHaveLength(1);
    expect(groups[0].nodes[0].children.map((tag) => tag.label)).toEqual(['Donegal']);
  });
});

describe('expandTagIds', () => {
  it('returns the descendants of what was chosen, without the parents', () => {
    // `donegal` no devuelve `ireland`: quitar el hijo no puede resucitar al padre.
    expect(expandTagIds(TAGS, [3])).toEqual([3]);
    // `ireland` sí trae sus dos estilos regionales colgando.
    expect(expandTagIds(TAGS, [1])).toEqual([1, 3, 4]);
  });

  it('deduplicates and ignores ids that are not in the vocabulary', () => {
    expect(expandTagIds(TAGS, [1, 1, 3, 999])).toEqual([1, 3, 4]);
    expect(expandTagIds(TAGS, [])).toEqual([]);
  });

  it('terminates on a cycle instead of hanging or repeating an id', () => {
    const cyclic: Tag[] = [
      { id: 1, facet: 'mood', value: 'a', label: 'A', parent: 2, sort: 1 },
      { id: 2, facet: 'mood', value: 'b', label: 'B', parent: 1, sort: 2 },
    ];

    const expanded = expandTagIds(cyclic, [1, 2]);

    expect(expanded).toEqual([1, 2]);
    expect(new Set(expanded).size).toBe(expanded.length);
  });
});

describe('tagsForTune', () => {
  it('keeps only the rows of that tune and gives a set of ids', () => {
    const assignments = [
      { tune_id: 'tune-a', tag_id: 1 },
      { tune_id: 'tune-a', tag_id: 3 },
      { tune_id: 'tune-b', tag_id: 20 },
      { tune_id: 'tune-a', tag_id: 1 },
    ];

    const ids = tagsForTune(assignments, 'tune-a');

    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 3]);
    expect(tagsForTune(assignments, 'tune-c').size).toBe(0);
  });
});

describe('filterBySelectedTags', () => {
  /**
   * Cinco tunes con una historia distinta: `t-a` lleva `donegal` (hijo de
   * `ireland`), `t-b` escocesa con dos moods/technique, `t-c` irlandesa técnica,
   * `t-d` solo la raíz `ireland` y `t-e` sin ninguna etiqueta.
   */
  const ROWS = ['t-a', 't-b', 't-c', 't-d', 't-e'].map((id) => ({ tune: { id } }));

  const ASSIGNMENTS = [
    { tune_id: 't-a', tag_id: 3 }, // Donegal
    { tune_id: 't-a', tag_id: 20 }, // Melancholy
    { tune_id: 't-b', tag_id: 2 }, // Scotland
    { tune_id: 't-b', tag_id: 11 }, // Cuts
    { tune_id: 't-b', tag_id: 20 }, // Melancholy
    { tune_id: 't-c', tag_id: 3 }, // Donegal
    { tune_id: 't-c', tag_id: 10 }, // Rolls
    { tune_id: 't-d', tag_id: 1 }, // Ireland
  ];

  const ids = (rows: { tune: { id: string } }[]) => rows.map((row) => row.tune.id);

  it('without a selection every row passes', () => {
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [], TAGS))).toEqual([
      't-a',
      't-b',
      't-c',
      't-d',
      't-e',
    ]);
  });

  it('expands the selection to descendants: Ireland brings the Donegal-only tunes', () => {
    // `t-d` lleva la raíz; `t-a` y `t-c` solo el hijo. Las tres son irlandesas.
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [1], TAGS))).toEqual([
      't-a',
      't-c',
      't-d',
    ]);
  });

  it('picking a child does not resurrect the parent', () => {
    // Donegal dentro; `t-d`, marcada solo `ireland`, se queda fuera.
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [3], TAGS))).toEqual(['t-a', 't-c']);
  });

  it('ANDs across facets: Ireland + Melancholy leaves only the tune with both', () => {
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [1, 20], TAGS))).toEqual(['t-a']);
  });

  it('ORs inside a facet: two techniques accept either one', () => {
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [10, 11], TAGS))).toEqual(['t-b', 't-c']);
  });

  it('ignores ids that are not in the vocabulary instead of emptying the list', () => {
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [999], TAGS))).toEqual([
      't-a',
      't-b',
      't-c',
      't-d',
      't-e',
    ]);
    // Un id desconocido junto a uno bueno no cambia el resultado del bueno.
    expect(ids(filterBySelectedTags(ROWS, ASSIGNMENTS, [999, 1], TAGS))).toEqual([
      't-a',
      't-c',
      't-d',
    ]);
  });

  it('drops a tune whose tag is not in the vocabulary: no facet to point at', () => {
    const assignments = [...ASSIGNMENTS, { tune_id: 't-e', tag_id: 999 }];
    expect(ids(filterBySelectedTags(ROWS, assignments, [1], TAGS))).toEqual([
      't-a',
      't-c',
      't-d',
    ]);
  });

  it('does not mutate or reorder the rows it keeps', () => {
    const filtered = filterBySelectedTags(ROWS, ASSIGNMENTS, [1], TAGS);
    expect(filtered.map((row) => row.tune.id)).toEqual(['t-a', 't-c', 't-d']);
    expect(ROWS).toHaveLength(5);
  });
});
