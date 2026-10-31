import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import {
  STATUS_LABELS,
  cardKey,
  displayRhythm,
  displayTitle,
  practiceSummary,
  stalenessColor,
  stalenessDays,
  stalenessTag,
  stalenessTitle,
  type RepertoireRow,
} from '../lib/repertoire-model';
import { focalPosition } from '../lib/image-sources';

/**
 * La carta del repertorio (#29): la foto ocupa toda la carta y todos los datos
 * van encima.
 *
 * **Una sola carta para todas las filas.** Hubo dos densidades —`card` en las
 * bandas de trabajo, `tile` en las de biblioteca— y se retiraron el 2026-10-31:
 * la home nunca recorre una banda entera (dos filas como mucho) y el listado
 * completo de un peldaño es una lista, así que la miniatura no ahorraba nada y
 * sí costaba el medidor de calidad y un kebab por debajo del mínimo táctil.
 *
 * Lo que la carta NO hace: decir el estado. La banda ya lo dice, y repetirlo en
 * cada carta con cien tunes es ruido (§2.2 del issue).
 *
 * Sin foto (rama del «no», §4) la carta se pinta sobre papel: sin degradado
 * oscuro, sin texto en blanco y sin iniciales.
 */

export interface TuneCardProps {
  row: RepertoireRow;
  /** Instante de la vista: los días del tag se calculan fuera, no aquí. */
  now: number;
  /** El «Practise» del menú: lo resuelve la pantalla, que es quien recarga. */
  onPractise: (row: RepertoireRow) => void | Promise<void>;
  /**
   * Añade el peldaño al final de `rhythm · key` (#9), por ejemplo
   * `Reel · D · Learning`. Es opt-in y por defecto va apagado: en la home la
   * banda ya dice el peldaño y repetirlo en cada carta sería ruido. La búsqueda
   * sí lo enciende, porque cruza los cuatro peldaños y la carta tiene que decir
   * de dónde sale cada resultado. Una fila aparcada dice `Shelved`, no su
   * peldaño: el cajón manda sobre la escalera.
   */
  showLevel?: boolean;
}

/**
 * Un solo menú abierto a la vez, compartido por todas las cartas de la pantalla:
 * abrir uno cierra el anterior sin que el padre tenga que llevar la cuenta.
 */
let activeMenu: (() => void) | null = null;

export default function TuneCard(props: TuneCardProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);

  const title = createMemo(() => displayTitle(props.row));
  const days = createMemo(() => stalenessDays(props.row, props.now));
  const tag = createMemo(() => stalenessTag(days()));
  const colour = createMemo(() => stalenessColor(days()));
  const summary = createMemo(() => practiceSummary(props.row));
  const key = createMemo(() => cardKey(props.row));

  const closeMenu = () => {
    setMenuOpen(false);
    if (activeMenu === closeMenu) activeMenu = null;
  };

  const toggleMenu = () => {
    if (menuOpen()) {
      closeMenu();
      return;
    }
    if (activeMenu) activeMenu();
    setMenuOpen(true);
    activeMenu = closeMenu;
  };

  /**
   * Escape y clic fuera. Los escuchantes viven solo mientras el menú está
   * abierto: con 176 cartas en pantalla, dos escuchantes permanentes por carta
   * son doscientos objetos que no hacen nada. El clic que abre el menú no lo
   * cierra porque el disparador corta la propagación.
   */
  createEffect(() => {
    if (!menuOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onClickAway = () => closeMenu();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickAway);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickAway);
    });
  });

  onCleanup(() => {
    if (activeMenu === closeMenu) activeMenu = null;
  });

  return (
    <article
      class="card"
      classList={{
        'card--photo': Boolean(props.row.image),
        'card--bare': !props.row.image,
      }}
      data-days={days() === null ? 'never' : String(days())}
      data-band={props.row.status}
    >
      {/*
        El fondo del tune (#31) se conserva tal cual: un `img` a sangre con
        `object-fit: cover`, `loading="lazy"` y el focal guardado. Es `img` y no
        `background-image` a propósito —`loading="lazy"` solo existe en `img`—, y
        el zoom elegido en el selector entra en el `transform` de la carta.
      */}
      <Show when={props.row.image}>
        {(image) => (
          <img
            src={image().thumbUrl ?? ''}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            style={{
              'object-position': focalPosition(image().focalX, image().focalY),
              '--zoom': String(image().zoom),
            }}
          />
        )}
      </Show>

      {/* El tag es el tiempo sin tocarla, y su color sale del gradiente. */}
      <span
        class="tag"
        title={stalenessTitle(tag())}
        style={{ background: colour().background, color: colour().foreground }}
      >
        <Show when={tag().unit} fallback={tag().value}>
          <b>{tag().value}</b> {tag().unit}
        </Show>
      </span>

      <button
        type="button"
        class="kebab"
        aria-label={`Actions for ${title()}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen()}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
      >
        <span />
        <span />
        <span />
      </button>

      <div
        class="menu"
        classList={{ open: menuOpen() }}
        role="menu"
        aria-label={`Actions for ${title()}`}
        onClick={(event) => event.stopPropagation()}
      >
        <A role="menuitem" href={`/repertoire/${props.row.id}`} onClick={closeMenu}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          View details
        </A>
        <A role="menuitem" href={`/repertoire/${props.row.id}`} onClick={closeMenu}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" />
          </svg>
          Edit details
        </A>
        {/*
          «Add to set» no tiene destino todavía: los sets llegan en #15. Se deja
          en el menú, deshabilitado y con el motivo en el title, en vez de
          inventar una pantalla a medias.
        */}
        <button type="button" role="menuitem" disabled title="Sets are not built yet">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add to set
        </button>
        <div class="sep" />
        <button
          type="button"
          role="menuitem"
          class="primary"
          onClick={() => {
            closeMenu();
            void props.onPractise(props.row);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Practise
        </button>
      </div>

      <div class="body">
        <h2>
          <A href={`/repertoire/${props.row.id}`} title={title()}>
            {title()}
          </A>
        </h2>
        <p class="tune-meta">
          {displayRhythm(props.row)} <span class="gap">·</span>{' '}
          <Show when={key()} fallback={<span class="missing">key not set</span>}>
            {key()}
          </Show>
          {/* El peldaño, solo cuando la pantalla lo pide (#9): la búsqueda
              cruza los cuatro y necesita decir de qué nivel es cada carta. */}
          <Show when={props.showLevel}>
            {' '}
            <span class="gap">·</span>{' '}
            <span class="level">
              {props.row.shelved ? 'Shelved' : STATUS_LABELS[props.row.status]}
            </span>
          </Show>
        </p>
        {/* El medidor de calidad va en todas las cartas: es el dato que más dice
            de una tune ya tocada, y estaba desapareciendo justo en las bandas de
            biblioteca, que son las que tienen historial. */}
        <p
          class="quality"
          classList={{ none: summary().empty }}
          aria-label={
            summary().empty
              ? summary().text
              : `Average quality ${props.row.avg_quality} of 5 over ${props.row.practice_count} practices`
          }
        >
          <Show when={summary().dots.length > 0}>
            <span class="q" aria-hidden="true">
              <For each={summary().dots}>{(dot) => <i class={dot} />}</For>
            </span>
          </Show>
          <span class="n">{summary().text}</span>
        </p>
      </div>
    </article>
  );
}
