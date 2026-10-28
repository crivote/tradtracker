import { For, Show, createSignal } from 'solid-js';
import { logPractice } from '../lib/practice';

/**
 * Panel de registro de un ensayo (#10, corte 1), reutilizable en la card del
 * repertorio y en el detalle del tune.
 *
 * Se abre en línea, dentro de la propia página, no en un modal: no hace falta
 * una librería ni `window.confirm`, y así el panel no tapa el contexto (la card
 * que dice cuándo se ensayó por última vez).
 *
 * El panel solo gestiona su estado de UI; la escritura y la compensación viven
 * en `logPractice`. La calidad es opcional: se puede guardar sin puntuar el
 * ensayo, y por eso `Clear` existe — una vez elegida, la única forma de volver a
 * «sin puntuar» es desmarcarla.
 *
 * Si falla, el mensaje real se queda en el panel y el panel sigue abierto con lo
 * introducido: perder el comentario por un fallo de red sería lo peor que puede
 * hacer este componente.
 */

export interface PracticeLogProps {
  /** El uuid de `pr_repertoire` (no el `origin_ref` de TheSession). */
  repertoireId: string;
  /** Recarga de la vista que lo contiene, para que «Practiced» se actualice. */
  onLogged: () => void | Promise<void>;
}

const QUALITIES = [1, 2, 3, 4, 5];

/** Comentario en blanco = sin comentario: la base no debe guardar `''`. */
function normalizeComment(comment: string): string | null {
  const trimmed = comment.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function PracticeLog(props: PracticeLogProps) {
  const [open, setOpen] = createSignal(false);
  const [quality, setQuality] = createSignal<number | null>(null);
  const [comment, setComment] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const reset = () => {
    setQuality(null);
    setComment('');
    setError(null);
  };

  /**
   * El disparador y el panel no conviven: al abrirse, el panel ocupa el sitio
   * del botón y `Cancel` lo devuelve. Así no hay dos formas de cerrarlo.
   */
  const openPanel = () => {
    reset();
    setOpen(true);
  };

  const cancel = () => {
    if (saving()) return;
    setOpen(false);
    reset();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await logPractice(props.repertoireId, {
        quality: quality(),
        comment: normalizeComment(comment()),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
      return;
    }

    setSaving(false);
    setOpen(false);
    reset();

    // La recarga es de la vista que contiene el panel: si falla, su propio
    // mensaje de error manda y no se pinta aquí, dentro de un panel ya cerrado.
    try {
      await props.onLogged();
    } catch {
      /* la vista decide dónde mostrar el fallo de recarga */
    }
  };

  const qualityClass = (value: number) =>
    `h-9 w-9 rounded border text-sm ${
      quality() === value
        ? 'border-amber-500 bg-amber-500 font-medium text-gray-900'
        : 'border-gray-600 text-gray-200 hover:border-amber-500 hover:text-amber-300'
    } disabled:opacity-60`;

  return (
    <div class="space-y-2">
      <Show
        when={open()}
        fallback={
          <button
            type="button"
            class="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:border-amber-500 hover:text-amber-300"
            onClick={openPanel}
          >
            Practice now
          </button>
        }
      >
        <section class="space-y-3 rounded border border-gray-700 bg-gray-800 p-3">
          <h3 class="text-sm font-medium text-amber-300">Log a practice</h3>

          <fieldset class="space-y-2">
            <legend class="text-xs text-gray-400">How did it go? (optional)</legend>
            <div class="flex flex-wrap items-center gap-2">
              <For each={QUALITIES}>
                {(value) => (
                  <button
                    type="button"
                    class={qualityClass(value)}
                    aria-pressed={quality() === value}
                    disabled={saving()}
                    onClick={() => setQuality(value)}
                  >
                    {value}
                  </button>
                )}
              </For>
              <Show when={quality() !== null}>
                <button
                  type="button"
                  class="text-xs text-gray-400 underline hover:text-amber-300 disabled:opacity-60"
                  disabled={saving()}
                  onClick={() => setQuality(null)}
                >
                  Clear
                </button>
              </Show>
            </div>
          </fieldset>

          <textarea
            class="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none disabled:opacity-60"
            rows={3}
            aria-label="Practice comment"
            placeholder="Comment (optional)"
            disabled={saving()}
            value={comment()}
            onInput={(event) => setComment(event.currentTarget.value)}
          />

          <Show when={error()}>
            <p class="rounded border border-red-800 bg-red-900/40 px-2 py-1 text-xs text-red-200" role="alert">
              {error()}
            </p>
          </Show>

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:border-gray-400 disabled:opacity-60"
              disabled={saving()}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-60"
              disabled={saving()}
              onClick={() => void save()}
            >
              {saving() ? 'Saving…' : 'Save practice'}
            </button>
          </div>
        </section>
      </Show>
    </div>
  );
}
