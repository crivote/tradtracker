import { For, Show, createMemo } from 'solid-js';
import type { SessionAverages as Averages, SessionPoint } from '../lib/practice-history';

/**
 * Las dos medias por sesión del historial, con su serie.
 *
 * Una **sesión** es un día con ensayo; los días vacíos no entran aquí (están en
 * la gráfica del calendario). Por eso estas barras son más cortas que el rango:
 * cada una es una sesión, no un día.
 *
 * Las dos figuras comparten forma y no eje: la de tunes se escala al máximo de
 * la ventana y la de valoración tiene escala **fija de 1 a 5**, porque 4,2 sobre
 * 5 significa algo y 4,2 reescalado al máximo de la semana no.
 *
 * Es CSS puro, como `PracticeChart`: con decenas de barras, un SVG escalable
 * deforma el texto y obliga a calcular posiciones a mano.
 */
export default function SessionAverages(props: {
  sessions: SessionPoint[];
  averages: Averages;
}) {
  const maxTunes = createMemo(() =>
    props.sessions.reduce((top, session) => Math.max(top, session.practices), 0),
  );

  const tunesText = () =>
    props.averages.tunesPerSession === null ? '—' : props.averages.tunesPerSession.toFixed(1);

  const ratingText = () =>
    props.averages.avgQualityPerSession === null
      ? '—'
      : props.averages.avgQualityPerSession.toFixed(1);

  const tunesHeight = (practices: number): string => {
    const ratio = practices / Math.max(1, maxTunes());
    return `max(6px, ${Math.round(ratio * 100)}%)`;
  };

  /** Escala fija: una valoración de 5 llena la barra, y 3 la deja al 60 %. */
  const ratingHeight = (quality: number | null): string => {
    if (quality === null) return '2px';
    return `max(4px, ${Math.round((Math.min(5, Math.max(0, quality)) / 5) * 100)}%)`;
  };

  const tunesSummary = createMemo(
    () =>
      `Tunes per session: ${tunesText()} on average over ` +
      `${props.averages.sessions} ${props.averages.sessions === 1 ? 'session' : 'sessions'}.`,
  );

  const ratingSummary = createMemo(
    () =>
      `Rating per session: ${ratingText()} out of 5 on average over ` +
      `${props.averages.ratedSessions} rated ${
        props.averages.ratedSessions === 1 ? 'session' : 'sessions'
      }.`,
  );

  return (
    <Show when={props.sessions.length > 0}>
      <section class="session-averages" aria-label="Averages per session">
        <figure class="session-figure">
          <figcaption class="session-figure__head">
            <b>{tunesText()}</b>
            <small>tunes per session</small>
          </figcaption>
          <div class="session-bars" role="img" aria-label={tunesSummary()}>
            <For each={props.sessions}>
              {(session) => (
                <span
                  class="session-bar"
                  style={{ height: tunesHeight(session.practices) }}
                  title={`${session.label} — ${session.practices} ${
                    session.practices === 1 ? 'tune' : 'tunes'
                  }`}
                >
                  <span class="session-bar__fill" />
                </span>
              )}
            </For>
          </div>
          <p class="session-axis">
            <span>{props.sessions[0]?.label ?? ''}</span>
            <span>
              {props.averages.sessions} {props.averages.sessions === 1 ? 'session' : 'sessions'}
            </span>
            <span>{props.sessions.at(-1)?.label ?? ''}</span>
          </p>
        </figure>

        <figure class="session-figure">
          <figcaption class="session-figure__head">
            <b>{ratingText()}</b>
            <small>rating per session · out of 5</small>
          </figcaption>
          <div class="session-bars session-bars--rating" role="img" aria-label={ratingSummary()}>
            <For each={props.sessions}>
              {(session) => (
                <span
                  class="session-bar"
                  classList={{ 'is-unrated': session.avgQuality === null }}
                  style={{ height: ratingHeight(session.avgQuality) }}
                  title={
                    session.avgQuality === null
                      ? `${session.label} — not rated`
                      : `${session.label} — ${session.avgQuality.toFixed(1)} / 5`
                  }
                >
                  <span class="session-bar__fill" />
                </span>
              )}
            </For>
          </div>
          <p class="session-axis">
            <span>{props.sessions[0]?.label ?? ''}</span>
            <span>
              {props.averages.ratedSessions} rated{' '}
              {props.averages.ratedSessions === 1 ? 'session' : 'sessions'}
            </span>
            <span>{props.sessions.at(-1)?.label ?? ''}</span>
          </p>
        </figure>
      </section>
    </Show>
  );
}
