import { displayTitle, type RepertoireRow } from '../lib/repertoire-model';
import { currentTrack, dockState, openFrom } from '../lib/player-store';

/**
 * El disparador del reproductor (#49), el mismo en las cuatro superficies:
 * carta, fila de tabla, ficha y lista de ensayo.
 *
 * Tres cosas que no son negociables:
 *   · **Mismo nombre accesible en todas**: `Play <tune>`. No cambia a «Pause»
 *     al sonar —para eso está `aria-pressed`—, porque un nombre que cambia
 *     obliga a buscarlo de nuevo cada vez.
 *   · **Mínimo táctil**: 28 px, por encima del mínimo de 24 (WCAG 2.5.8) y por
 *     debajo del kebab, que no debe competir con él.
 *   · **No navega.** La carta es un `<article>` con el enlace solo en el título,
 *     pero el disparador corta la propagación igual: dentro de una fila de
 *     tabla o de una lista, un clic no puede acabar en otra ruta.
 */
export default function PlayTrigger(props: { row: RepertoireRow; class?: string }) {
  const active = () => {
    const state = dockState();
    return (
      currentTrack()?.id === props.row.id && (state === 'playing' || state === 'loading')
    );
  };

  return (
    <button
      type="button"
      class={`play-trigger${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'is-active': active() }}
      aria-label={`Play ${displayTitle(props.row)}`}
      aria-pressed={active() ? 'true' : 'false'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openFrom(props.row);
      }}
    >
      <span aria-hidden="true">{active() ? '❚❚' : '▶'}</span>
    </button>
  );
}
