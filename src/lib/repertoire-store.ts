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
  fetchRepertoire,
  saveFavorite,
  saveStatus,
  type RepertoireRow,
  type TuneStatus,
} from './repertoire';
import { logPractice } from './practice';

export interface RepertoireStore {
  rows: Accessor<RepertoireRow[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  /** Instante de la vista: los días de todas las filas hablan del mismo «hoy». */
  now: Accessor<number>;
  /** Id de la fila que está escribiendo (alta, ensayo): deshabilita su control. */
  busyId: Accessor<string | number | null>;
  /** Carga con estado de carga: la pantalla enseña «Loading…», no una rejilla vacía. */
  load: () => Promise<void>;
  /** Recarga sin estado de carga: tras escribir, para que no parpadee la rejilla. */
  reload: () => Promise<void>;
  practise: (row: RepertoireRow) => Promise<void>;
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
   * «Practise» apunta el ensayo de un clic, sin puntuarlo: la calidad es
   * opcional por diseño (#10) y se puntúa en el detalle. Obligar a un formulario
   * para apuntar que has tocado una tune mataría el gesto.
   */
  const practise = async (row: RepertoireRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await logPractice(row.id, { quality: null, comment: null });
      await reload();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusyId(null);
    }
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
