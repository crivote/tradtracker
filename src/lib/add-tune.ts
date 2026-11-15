/**
 * El alta, montada una sola vez (#65).
 *
 * El cajón del alta vivía en cada pantalla: la home y el banco de trabajo
 * tenían su propio `addOpen`, su propio `<AddTuneAside>` y su propio botón. Con
 * «Add a tune» en el menú principal —siempre presente— eso deja de sostenerse:
 * el menú vive en `Layout` y no puede abrir el estado de la ruta. El cajón pasa
 * a ser uno, como el popup de ensayo y el reproductor.
 *
 * El estado es un módulo, no un contexto de Solid: lo consumen el botón del
 * menú y el host, que son hermanos dentro del armazón, y un contexto añadiría
 * un proveedor para dos nodos.
 */
import { createSignal } from 'solid-js';

const [open, setOpen] = createSignal(false);

/** Si el cajón del alta está abierto. */
export const addTuneOpen = open;

export function openAddTune(): void {
  setOpen(true);
}

export function closeAddTune(): void {
  setOpen(false);
}

/**
 * Aviso de que el repertorio cambió, para que la pantalla que hay debajo se
 * recargue sin que el cajón conozca la ruta.
 *
 * El cajón ya no recibe el `reload` de la pantalla —no sabe cuál está montada—,
 * así que publica el hecho y cada `createRepertoireStore` escucha. Es el mismo
 * puente que usaría cualquier otra escritura global.
 */
export const REPERTOIRE_CHANGED = 'repertoire:changed';

export function announceRepertoireChange(): void {
  window.dispatchEvent(new Event(REPERTOIRE_CHANGED));
}
