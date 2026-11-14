/**
 * Formato de las cifras del panel (#22): porcentajes, puntos porcentuales y
 * participaciones.
 *
 * Todas van con **un decimal y punto** (`37.1%`), porque la interfaz está en
 * inglés y así lo hace el resto de la app (`4.2 avg`). El modelo del corte A ya
 * devuelve redondeado a una décima; lo que se compone aquí son las cantidades
 * que el modelo no da (la participación de `sin registro` sobre el universo).
 */

/** `37.1%` — un decimal, sin espacio antes del signo. */
export function pctText(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** `+18.3 pp` / `-4.0 pp`: el signo se escribe para que la dirección se lea. */
export function signedPpText(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} pp`;
}

/**
 * Participación de `count` sobre `total`, en décimas: el mismo redondeo del
 * modelo (`round1`), que no se exporta porque allí es interno. Denominador cero
 * no es un 0 %: es 0, y quien lo pinta decide que no hay nada que enseñar.
 */
export function sharePct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}
