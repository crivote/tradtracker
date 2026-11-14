import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { logPractice } from '../lib/practice';
import {
  closePractice,
  consumeLogged,
  openPractice,
  practiceTarget,
  type PracticeLogged,
  type PracticeTarget,
} from '../lib/practice-mark';
import './practice-mark.css';

/**
 * Marcar un ensayo: **un popup, un disparador, en todas partes** (#10 revisado).
 *
 * El registro vivía en un panel en línea que solo existía en la ficha, así que
 * apuntar un ensayo desde la carta, el banco de trabajo o el listado era un clic
 * a ciegas: se escribía sin poder decir cómo había ido. Aquí el gesto «Practise»
 * abre siempre el mismo diálogo con la valoración —opcional, 1–5 en estrellas— y
 * una nota corta.
 *
 * Tres decisiones que no son de estilo:
 *   · **Portal al `body`.** La carta y la tabla recortan con `overflow` y tienen
 *     su propio contexto de apilamiento; un modal dentro de ellas dejaría de ser
 *     modal. El velo y el bloqueo del scroll son la otra mitad de lo mismo.
 *   · **Un solo valoración por toque.** La estrella elegida se puede volver a
 *     pulsar para dejarla en blanco: registrar sin puntuar es un caso legítimo
 *     (#10), y así no hace falta un «Clear» que ocupe una fila entera.
 *   · **El error no cierra nada.** Si la escritura falla, el mensaje real se
 *     queda dentro y lo tecleado sigue ahí: perder una nota por un fallo de red
 *     sería lo peor que puede hacer este componente.
 */

const QUALITIES = [1, 2, 3, 4, 5];

/** Palabras de la escala: la estrella sola no dice si un 3 es bueno o malo. */
const QUALITY_LABELS: Record<number, string> = {
  1: 'Rough',
  2: 'Shaky',
  3: 'Fair',
  4: 'Good',
  5: 'Strong',
};

/**
 * El disparador. `variant="menu"` lo pinta como renglón de menú (`role`) para
 * vivir dentro del kebab de la carta y de la tabla; por defecto es el botón de
 * siempre.
 */
export function PracticeMarkButton(props: {
  target: PracticeTarget;
  onLogged?: PracticeLogged;
  label?: string;
  variant?: 'button' | 'menu';
  class?: string;
  disabled?: boolean;
}) {
  const open = () => openPractice(props.target, props.onLogged);

  return (
    <Show
      when={props.variant === 'menu'}
      fallback={
        <button
          type="button"
          class={props.class ?? 'pm-trigger'}
          disabled={props.disabled}
          onClick={open}
        >
          {props.label ?? 'Practice now'}
        </button>
      }
    >
      <button
        type="button"
        role="menuitem"
        class={props.class}
        disabled={props.disabled}
        onClick={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
        </svg>
        {props.label ?? 'Practise'}
      </button>
    </Show>
  );
}

/** El popup único de la aplicación. Se monta una vez, en el armazón. */
export function PracticeMarkHost() {
  return (
    <Show when={practiceTarget()}>
      {(target) => (
        <Portal mount={document.body}>
          <PracticeDialog target={target()} onClose={closePractice} />
        </Portal>
      )}
    </Show>
  );
}

function PracticeDialog(props: { target: PracticeTarget; onClose: () => void }) {
  const [quality, setQuality] = createSignal<number | null>(null);
  const [comment, setComment] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** Estrella bajo el puntero: previsualiza sin escribir nada. */
  const [hovered, setHovered] = createSignal<number | null>(null);

  let panel: HTMLDivElement | undefined;
  let opener: Element | null = null;
  let previousOverflow = '';

  onMount(() => {
    opener = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // El foco entra en el diálogo, no en la primera estrella: el lector anuncia
    // el título y la escala antes de que nadie pulse nada.
    panel?.focus();
  });

  onCleanup(() => {
    document.body.style.overflow = previousOverflow;
    // Si el disparador era el renglón de un menú que se cerró, ya no está en el
    // documento y devolverle el foco no tiene sentido.
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  });

  const cancel = () => {
    if (saving()) return;
    props.onClose();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Sin sesión ni posición: la marca es la tune **y el día**, y el día lo
      // compone `logPractice` con el reloj. Valorar una fila ya marcada
      // actualiza esa marca (unique por día) en vez de crear otro ensayo.
      const practiceId = await logPractice(props.target.repertoireId, {
        quality: quality(),
        comment: comment(),
      });
      // El callback de recarga se toma antes de cerrar: cerrar limpia el estado
      // del popup y con él la referencia a la pantalla que lo abrió.
      const logged = consumeLogged();
      props.onClose();
      try {
        await logged?.(practiceId);
      } catch {
        /* la vista decide dónde mostrar el fallo de recarga */
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  /** El foco no se escapa del diálogo: Tab da la vuelta dentro del panel. */
  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
      return;
    }
    trapTab(event);
  };

  /** La estrella elegida se puede deseleccionar: puntuar no es obligatorio. */
  const choose = (value: number) => setQuality(quality() === value ? null : value);

  const filled = (value: number) => value <= (hovered() ?? quality() ?? 0);

  return (
    <div class="pm-veil" onClick={cancel}>
      <div
        class="pm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-title"
        aria-describedby="pm-hint"
        tabindex="-1"
        ref={panel}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header class="pm-head">
          <p class="pm-kicker">Log a practice</p>
          <h2 id="pm-title">{props.target.title}</h2>
        </header>

        <div class="pm-stars" role="group" aria-label="How did it go?">
          <For each={QUALITIES}>
            {(value) => (
              <button
                type="button"
                class="pm-star"
                classList={{ 'is-on': filled(value) }}
                aria-label={`${value} of 5 — ${QUALITY_LABELS[value]}`}
                aria-pressed={quality() === value}
                disabled={saving()}
                onMouseEnter={() => setHovered(value)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(value)}
                onBlur={() => setHovered(null)}
                onClick={() => choose(value)}
              >
                <span aria-hidden="true">{filled(value) ? '★' : '☆'}</span>
              </button>
            )}
          </For>
          <span class="pm-scale" aria-live="polite">
            {quality() === null ? 'Optional' : QUALITY_LABELS[quality()!]}
          </span>
        </div>

        <textarea
          class="pm-note"
          rows={2}
          aria-label="Practice note"
          placeholder="Anything worth remembering? (optional)"
          disabled={saving()}
          value={comment()}
          onInput={(event) => setComment(event.currentTarget.value)}
        />

        <p class="pm-hint" id="pm-hint">
          Rating is optional — save it blank to just log the practice.
        </p>

        <Show when={error()}>
          <p class="pm-error" role="alert">
            {error()}
          </p>
        </Show>

        <footer class="pm-actions">
          <button type="button" class="pm-cancel" disabled={saving()} onClick={cancel}>
            Cancel
          </button>
          <button type="button" class="pm-save" disabled={saving()} onClick={() => void save()}>
            {saving() ? 'Saving…' : 'Save practice'}
          </button>
        </footer>
      </div>
    </div>
  );
}
