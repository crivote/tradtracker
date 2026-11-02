import { For, createMemo } from 'solid-js';
import type { FacetGroup, Tag } from '../lib/tags';

/**
 * El árbol de casillas de las etiquetas por facetas (F17, #48), compartido por
 * el detalle y por la tabla del listado.
 *
 * Una sola verdad: el marcado es el mismo en los dos sitios —un `fieldset` por
 * faceta con su `legend`, una casilla por valor y los hijos **indentados** bajo
 * su raíz—, y el nombre accesible se calcula aquí. Las clases son mixtas a
 * propósito: `.tag-check` (y compañía) visten el árbol sobre el papel del
 * repertorio y las utilidades de Tailwind, la paleta oscura del detalle; dentro
 * de `.repertoire-home` el CSS de papel gana por especificidad y fuera de él no
 * existe, así que cada superficie conserva su lenguaje visual sin una variante.
 *
 * Todo son casillas, también `tradition`: la jerarquía es de un nivel y se
 * expresa indenando, no con selección única.
 */

export interface TagPickerProps {
  /** Ya construido con `facetTree()`: el componente no reordena ni filtra. */
  groups: FacetGroup[];
  /** Ids marcados. */
  selected: readonly number[];
  onToggle: (tagId: number, next: boolean) => void;
  disabled?: boolean;
  /** Prefijo para que dos instancias en la misma página no compartan ids de input. */
  idPrefix?: string;
}

export default function TagPicker(props: TagPickerProps) {
  /**
   * Dos etiquetas con el mismo texto en facetas distintas necesitan la faceta
   * en el nombre accesible (`Mood: Lonesome`); con texto único, el `aria-label`
   * es solo la etiqueta. Solo cuentan las que se pintan: un valor huérfano que
   * `facetTree` dejó fuera no puede crear una ambigüedad que el lector no ve.
   */
  const repeatedLabels = createMemo(() => {
    const facetsByLabel = new Map<string, Set<string>>();

    for (const group of props.groups) {
      const tags: Tag[] = [];
      for (const node of group.nodes) tags.push(node.tag, ...node.children);

      for (const tag of tags) {
        const seen = facetsByLabel.get(tag.label);
        if (seen) seen.add(group.facet.id);
        else facetsByLabel.set(tag.label, new Set([group.facet.id]));
      }
    }

    return new Set(
      [...facetsByLabel].filter(([, facets]) => facets.size > 1).map(([label]) => label)
    );
  });

  const labelOf = (tag: Tag, facetLabel: string) =>
    repeatedLabels().has(tag.label) ? `${facetLabel}: ${tag.label}` : tag.label;

  /** Una casilla; los hijos van indentados bajo su raíz. */
  const box = (tag: Tag, facetLabel: string, child = false) => (
    <label
      class={`tag-check flex items-center gap-2 text-sm ${
        child ? 'tag-check--child pl-4 text-gray-300' : 'text-gray-200'
      }`}
    >
      <input
        id={props.idPrefix ? `${props.idPrefix}-tag-${tag.id}` : undefined}
        type="checkbox"
        class="accent-amber-400"
        aria-label={labelOf(tag, facetLabel)}
        checked={props.selected.includes(tag.id)}
        disabled={props.disabled}
        onChange={(event) => props.onToggle(tag.id, event.currentTarget.checked)}
      />
      {tag.label}
    </label>
  );

  return (
    <For each={props.groups}>
      {(group) => (
        <div class="tag-facet">
          <fieldset class="space-y-1">
            <legend class="facet-name text-xs text-gray-400">{group.facet.label}</legend>
            <For each={group.nodes}>
              {(node) => (
                <>
                  {box(node.tag, group.facet.label)}
                  <For each={node.children}>
                    {(child) => box(child, group.facet.label, true)}
                  </For>
                </>
              )}
            </For>
          </fieldset>
        </div>
      )}
    </For>
  );
}
