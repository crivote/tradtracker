import { Show, createEffect, createSignal } from 'solid-js';
import AddTuneAside from './AddTuneAside';
import { addTuneOpen, announceRepertoireChange, closeAddTune } from '../lib/add-tune';
import { slotsFor, type LearningSlots } from '../lib/repertoire-model';
import { readPrefs } from '../lib/practice-storage';
import { fetchAddTuneContext } from '../lib/repertoire';

/**
 * El cajón del alta, montado una sola vez en el armazón (#65).
 *
 * Mismo patrón que `PracticeMarkHost`: el diálogo vive en `Layout` y los
 * disparadores están repartidos —aquí, el botón del menú principal—. El cajón no
 * conoce la ruta, así que **no recibe su `reload`**: pide su contexto ligero
 * (refs ya poseídas y ocupación del banco) al abrirse, y al añadir publica el
 * cambio para que la pantalla de debajo se recargue.
 *
 * El contexto se pide **al abrir, no al montar**: la mayoría de las sesiones no
 * abren el cajón, y cargar el repertorio para nadie es trabajo regalado.
 *
 * Si la consulta falla, el cajón se abre igual sin la lista de refs: el peor
 * caso es ofrecer un alta que ya existe, y la base —con su restricción y su
 * mensaje— lo dirá en el propio cajón. Bloquear el alta por un fallo de lectura
 * sería peor.
 */
export default function AddTuneHost() {
  const [refs, setRefs] = createSignal<Set<string>>(new Set());
  const [slots, setSlots] = createSignal<LearningSlots>(slotsFor(0, 1));
  const [ready, setReady] = createSignal(false);

  createEffect(() => {
    if (!addTuneOpen()) return;

    let cancelled = false;
    setReady(false);
    void fetchAddTuneContext(readPrefs(window.localStorage).learningSlots)
      .then((context) => {
        if (cancelled) return;
        setRefs(context.refs);
        setSlots(context.slots);
      })
      .catch(() => {
        if (cancelled) return;
        setRefs(new Set<string>());
        setSlots(slotsFor(0, readPrefs(window.localStorage).learningSlots));
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
  });

  return (
    <Show when={addTuneOpen() && ready()}>
      {/* El cajón se pinta con los tokens de papel, que viven en
          `.repertoire-home`; `--host` los aporta sin pintar una pantalla. */}
      <div class="repertoire-home repertoire-home--host">
        <AddTuneAside
          existingRefs={refs()}
          slots={slots()}
          onAdded={announceRepertoireChange}
          onClose={closeAddTune}
        />
      </div>
    </Show>
  );
}
