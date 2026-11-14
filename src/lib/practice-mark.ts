/**
 * Estado del popup de registro de ensayo, compartido por toda la aplicación.
 *
 * Hay **un solo popup** montado en el armazón (`PracticeMarkHost`) y N
 * disparadores (`PracticeMarkButton`, la acción «Practise» de los menús, el botón
 * de la lista de ensayo). Así el gesto es literalmente el mismo en la carta, el
 * banco de trabajo, el listado, la ficha y la lista del día, en vez de cinco
 * copias que se separan al primer arreglo.
 *
 * El popup vive en un portal del `body` y no dentro del disparador: la carta y la
 * tabla tienen `overflow` y contextos de apilamiento propios, y un diálogo modal
 * recortado por su contenedor deja de ser modal.
 *
 * `onLogged` lo pone quien abre —la pantalla que sabe recargarse— y se ejecuta
 * **después** de escribir y cerrar. Aquí no se decide qué recargar.
 */
import { createSignal } from 'solid-js';

export interface PracticeTarget {
  /** uuid de `pr_repertoire`, nunca el `origin_ref` de TheSession. */
  repertoireId: string;
  /** Título ya compuesto por el modelo, solo para el encabezado del popup. */
  title: string;
}

export type PracticeLogged = (practiceId: string) => void | Promise<void>;

const [target, setTarget] = createSignal<PracticeTarget | null>(null);
let onLogged: PracticeLogged | null = null;

/** Abre el popup para una tune. Sustituye al registro silencioso de un clic. */
export function openPractice(tune: PracticeTarget, logged?: PracticeLogged): void {
  onLogged = logged ?? null;
  setTarget({ ...tune });
}

export function closePractice(): void {
  setTarget(null);
  onLogged = null;
}

/** El destino abierto, o `null` con el popup cerrado. */
export { target as practiceTarget };

/**
 * Lo que hay que hacer cuando el ensayo se guardó. Se consume **antes** de
 * cerrar para que un callback lento no se pierda si otra apertura lo pisa.
 */
export function consumeLogged(): PracticeLogged | null {
  const callback = onLogged;
  onLogged = null;
  return callback;
}
