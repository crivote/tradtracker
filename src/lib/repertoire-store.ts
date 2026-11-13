/**
 * Lo que comparten las tres pantallas de papel del repertorio: la home de la
 * biblioteca (`/`), el banco de trabajo (`/learning`) y el listado de un
 * peldaño (`/level/:band`).
 *
 * Las tres necesitan lo mismo —las filas, el instante de la vista, la recarga
 * silenciosa y los tres gestos que escriben— y ninguna necesita saber cómo se
 * carga. Sin este módulo, mover el banco de trabajo a su pantalla habría
 * triplicado cuarenta líneas de pintado optimista y recarga, y las tres copias
 * se habrían separado al primer arreglo.
 *
 * Lo que **no** vive aquí: qué se pinta y en qué orden. Eso es del modelo puro
 * (`repertoire-model.ts`) y de cada pantalla.
 */
import { createSignal, type Accessor } from 'solid-js';
import {
  displayTitle,
  fetchRepertoire,
  saveFavorite,
  saveStatus,
  type RepertoireRow,
  type TuneStatus,
} from './repertoire';
import { openPractice } from './practice-mark';

export interface RepertoireStore {
  rows: Accessor<RepertoireRow[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  /** Instante de la vista: los días de todas las filas hablan del mismo «hoy». */
  now: Accessor<number>;
  /** Id de la fila que está escribiendo (alta, peldaño, favorita). */
  busyId: Accessor<string | number | null>;
  /** Carga con estado de carga: la pantalla enseña «Loading…», no una rejilla vacía. */
  load: () => Promise<void>;
  /** Recarga sin estado de carga: tras escribir, para que no parpadee la rejilla. */
  reload: () => Promise<void>;
  /**
   * «Practise»: abre el popup de registro para esa fila. **No escribe** —quien
   * escribe es el popup, con la valoración y la nota— y recarga la pantalla al
   * guardar. Se conserva el nombre porque el gesto es el mismo de siempre.
   */
  practise: (row: RepertoireRow) => void;
  toggleFavorite: (row: RepertoireRow) => Promise<void>;
  changeStatus: (row: RepertoireRow, status: TuneStatus) => Promise<void>;
  setError: (message: string | null) => void;
}

/**
 * Los tres gestos se pintan **antes** de que responda la red y se deshacen si
 * falla. Una favorita o un peldaño fantasma envenenan el generador de la lista
 * de hoy (×1,4 y escalera), así que la reversión no es cosmética.
 */
export function createRepertoireStore(): RepertoireStore {
  const [rows, setRows] = createSignal<RepertoireRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [busyId, setBusyId] = createSignal<string | number | null>(null);

  const message = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  const reload = async () => {
    try {
      setRows(await fetchRepertoire());
      setNow(Date.now());
    } catch (cause) {
      setError(message(cause));
    }
  };

  /**
   * «Practise» abre el popup de ensayo, el mismo en toda la aplicación.
   *
   * Antes escribía en silencio y la valoración solo se podía poner en la ficha:
   * apuntar desde la carta o el taller era un clic a ciegas. El gesto no cambia
   * de nombre porque no cambia de intención; lo que cambia es que ahora pregunta
   * cómo fue antes de guardar. La recarga la dispara el popup al cerrar.
   */
  const practise = (row: RepertoireRow) => {
    openPractice(
      { repertoireId: row.id, title: displayTitle(row) },
      reload,
    );
  };

  const toggleFavorite = async (row: RepertoireRow) => {
    const before = row.favorite;
    const next = !before;
    const paint = (value: boolean) =>
      setRows((previous) =>
        previous.map((candidate) =>
          candidate.id === row.id ? { ...candidate, favorite: value } : candidate
        )
      );
    paint(next);
    setError(null);
    try {
      await saveFavorite(row.id, next);
    } catch (cause) {
      paint(before);
      setError(message(cause));
    }
  };

  const changeStatus = async (row: RepertoireRow, status: TuneStatus) => {
    const before = row.status;
    if (before === status) return;
    const paint = (value: TuneStatus) =>
      setRows((previous) =>
        previous.map((candidate) =>
          candidate.id === row.id ? { ...candidate, status: value } : candidate
        )
      );
    paint(status);
    setError(null);
    try {
      await saveStatus(row.id, status);
    } catch (cause) {
      paint(before);
      setError(message(cause));
    }
  };

  return {
    rows,
    loading,
    error,
    now,
    busyId,
    load,
    reload,
    practise,
    toggleFavorite,
    changeStatus,
    setError,
  };
}
