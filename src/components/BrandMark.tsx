import { TUNESHED_MARK_D } from '../assets/tuneshed-mark';

/**
 * Marca Tuneshed.
 *
 * Se pinta con `currentColor`: el color lo fija quien la contiene. Sobre el
 * header oscuro (gray-800) va en el tono claro de la familia verde, porque el
 * verde de marca `#172F1C` da 1,02:1 sobre ese fondo y desaparecería; sobre
 * papel va directamente el verde de marca, que da 12,67:1.
 *
 * Tamaño mínimo: 40 px de alto. Por debajo de 36 px los tres vanos internos del
 * dibujo se cierran (medido a umbral de cobertura del 50 %), y a 32 px la marca
 * ya se lee como una mancha.
 */
export const BrandMark = (props: { class?: string }) => (
  <svg
    viewBox="0 0 286.38 248.12"
    class={props.class}
    fill="currentColor"
    fill-rule="evenodd"
    role="img"
    aria-label="Tuneshed"
  >
    <path d={TUNESHED_MARK_D} />
  </svg>
);
