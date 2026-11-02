/**
 * Modelo puro del vocabulario de etiquetas (F17, #48). Sin red, sin Supabase y
 * sin Solid: solo datos y funciones, para poder probar el árbol y la expansión
 * sin tocar la base.
 *
 * El vocabulario es CERRADO y COMÚN —lo lee todo usuario autenticado y no lo
 * escribe el cliente—; la asignación es personal. `tradition` admite jerarquía de
 * UN nivel (`donegal → ireland`): la granularidad se expresa colgando del padre,
 * no con una faceta `region:` aparte.
 */

export type TagFacetId = 'tradition' | 'technique' | 'mood';

export interface TagFacetInfo {
  id: string;
  label: string;
  sort: number;
}

export interface Tag {
  id: number;
  facet: string;
  /** Slug canónico (`sliabh_luchra`); la UI nunca lo pinta. */
  value: string;
  label: string;
  /** Padre en el árbol de un nivel, o `null` si es raíz. */
  parent: number | null;
  sort: number;
}

export interface TagNode {
  tag: Tag;
  children: Tag[];
}

export interface FacetGroup {
  facet: TagFacetInfo;
  nodes: TagNode[];
}

/** Orden de la casa: `sort` y, a igualdad, `id` — nunca el orden de llegada. */
function bySortThenId(a: { sort: number; id: number | string }, b: { sort: number; id: number | string }): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * Facetas en su orden, cada una con sus raíces en orden y los hijos colgando de
 * su padre.
 *
 * Un `parent` que apunta a un id inexistente (o a un id de otra faceta) deja al
 * hijo **fuera** de la lista: no se promociona a raíz, porque entonces una tune
 * marcada `donegal` se pintaría como si fuera una tradición raíz y el lector no
 * vería el error del vocabulario. Tampoco se cuelga de un padre que ya es hijo:
 * el árbol es de un solo nivel por contrato de la migración 012.
 */
export function facetTree(facets: TagFacetInfo[], tags: Tag[]): FacetGroup[] {
  const byId = new Map<number, Tag>(tags.map((tag) => [tag.id, tag]));

  return [...facets].sort(bySortThenId).map((facet) => {
    const own = tags.filter((tag) => tag.facet === facet.id).sort(bySortThenId);
    const ownIds = new Set(own.map((tag) => tag.id));

    const nodes: TagNode[] = [];
    const childrenByParent = new Map<number, Tag[]>();

    for (const tag of own) {
      if (tag.parent === null) {
        nodes.push({ tag, children: [] });
        continue;
      }

      const parent = byId.get(tag.parent);
      // Huérfano (padre inexistente, de otra faceta, él mismo o ya nieto).
      if (!parent || parent.facet !== facet.id || !ownIds.has(tag.parent)) continue;
      if (parent.parent !== null) continue;

      const bucket = childrenByParent.get(tag.parent);
      if (bucket) bucket.push(tag);
      else childrenByParent.set(tag.parent, [tag]);
    }

    for (const node of nodes) node.children = childrenByParent.get(node.tag.id) ?? [];

    return { facet, nodes };
  });
}

/**
 * Los ids elegidos más todos sus descendientes. Para el filtro (corte 3) y para
 * saber qué se pinta marcado cuando la base sembró ancestros.
 *
 * - **No** añade los padres: quitar `donegal` deja `ireland` dentro, y expandir
 *   desde `donegal` no puede devolver `ireland`.
 * - Los ids desconocidos se ignoran; los resultados se deduplican y salen en
 *   orden ascendente, para que dos llamadas con el mismo conjunto den la misma
 *   lista.
 * - Un ciclo en los datos no cuelga la llamada: el `Set` de visitados lo corta.
 */
export function expandTagIds(tags: Tag[], selected: readonly number[]): number[] {
  const byId = new Map<number, Tag>(tags.map((tag) => [tag.id, tag]));

  const childrenByParent = new Map<number, number[]>();
  for (const tag of tags) {
    if (tag.parent === null || !byId.has(tag.parent)) continue;
    const bucket = childrenByParent.get(tag.parent);
    if (bucket) bucket.push(tag.id);
    else childrenByParent.set(tag.parent, [tag.id]);
  }

  const seen = new Set<number>();
  const stack: number[] = [];
  for (const id of selected) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      stack.push(id);
    }
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      stack.push(childId);
    }
  }

  return [...seen].sort((a, b) => a - b);
}

/** Etiquetas asignadas a una tune (ids), desde las filas de `pr_user_tune_tags`. */
export function tagsForTune(
  assignments: readonly { tune_id: string; tag_id: number }[],
  tuneId: string
): Set<number> {
  const ids = new Set<number>();
  for (const row of assignments) {
    if (row.tune_id === tuneId) ids.add(row.tag_id);
  }
  return ids;
}

/**
 * Filtra las filas por las etiquetas elegidas (F17, corte 3).
 *
 * - **AND entre facetas**: elegir `tradition:ireland` y `mood:melancholy` exige
 *   las dos.
 * - **OR dentro de una faceta**: dos moods distintos = cualquiera de los dos.
 * - La selección se **expande a descendientes** (`expandTagIds`): elegir
 *   `ireland` incluye lo marcado `donegal`, sin depender de que la escritura
 *   haya sembrado el ancestro. Quitar un hijo no resucita al padre.
 * - Sin selección, pasan todas.
 * - Un id elegido que no existe en `tags` se ignora: no puede abrir ni cerrar el
 *   filtro por sí solo, y si la selección entera es desconocida el resultado es
 *   «pasan todas», no «no pasa ninguna».
 *
 * Una etiqueta asignada que no esté en el vocabulario tampoco cuenta: no hay
 * faceta a la que apuntarla.
 */
export function filterBySelectedTags<T extends { tune: { id: string } }>(
  rows: readonly T[],
  assignments: readonly { tune_id: string; tag_id: number }[],
  selectedTagIds: readonly number[],
  tags: Tag[]
): T[] {
  const expanded = expandTagIds(tags, selectedTagIds);
  if (expanded.length === 0) return [...rows];

  const facetById = new Map<number, string>(tags.map((tag) => [tag.id, tag.facet]));

  /** Faceta → ids que valen (la selección ya expandida, agrupada por faceta). */
  const allowedByFacet = new Map<string, Set<number>>();
  for (const id of expanded) {
    const facet = facetById.get(id);
    if (!facet) continue;
    const bucket = allowedByFacet.get(facet);
    if (bucket) bucket.add(id);
    else allowedByFacet.set(facet, new Set([id]));
  }
  // Toda la selección era de ids desconocidos: no filtra, pero tampoco vacía.
  if (allowedByFacet.size === 0) return [...rows];

  /** tune_id → facetas que la tune ya cumple con alguna de sus etiquetas. */
  const satisfiedByTune = new Map<string, Set<string>>();
  for (const row of assignments) {
    const facet = facetById.get(row.tag_id);
    if (!facet || !allowedByFacet.get(facet)?.has(row.tag_id)) continue;
    const bucket = satisfiedByTune.get(row.tune_id);
    if (bucket) bucket.add(facet);
    else satisfiedByTune.set(row.tune_id, new Set([facet]));
  }

  return rows.filter((row) => {
    const satisfied = satisfiedByTune.get(row.tune.id);
    if (!satisfied) return false;
    for (const facet of allowedByFacet.keys()) {
      if (!satisfied.has(facet)) return false;
    }
    return true;
  });
}
