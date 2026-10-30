import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  BANDS,
  STATUS_LABELS,
  importSessionTunes,
  type SessionImportResult,
  type TuneStatus,
} from '../lib/repertoire';
import { SessionImportError, fetchTunebook, searchMembers } from '../lib/thesession-api';
import {
  importPlan,
  parseMemberId,
  type SessionMember,
  type SessionTune,
} from '../lib/thesession-import';

/**
 * Import del tunebook de The Session (#32, corte 2).
 *
 * Panel **en línea**, como el del catálogo: se abre debajo de la cabecera, no
 * tapa el repertorio y no hay `<dialog>` modal. El disparador vive al lado de
 * «Add a tune», en `.head-tools`.
 *
 * Tres cosas que el API obliga a separar y que aquí se ven seguidas:
 *   · Se busca por id (número, URL de ficha o de tunebook) o, si lo pegado es un
 *     nombre, por el buscador de miembros: `/members/<nombre>/tunebook` da 404,
 *     así que un nombre nunca es un id.
 *   · El tunebook se lee página a página y se cuenta mientras llega.
 *   · El peldaño no viene en el listado: lo elige quien importa, con la
 *     definición de `BANDS` al lado — sin eso, 400 tunes en la misma banda
 *     dejarían la home sin significado.
 *
 * La escritura no se hace aquí: `importSessionTunes` va por tandas de 100 y
 * tolera los duplicados. Este componente solo enseña el estado.
 *
 * Errores en línea con `role="alert"`; nunca `alert()`.
 */

export interface ImportFromSessionProps {
  /** `origin_ref` de los tunes que ya están en el repertorio del usuario. */
  existingRefs: Set<string>;
  /** Recarga de la home tras el alta (la que ya existe: `reload`). */
  onImported: () => void;
  onClose: () => void;
}

type Busy = 'idle' | 'looking' | 'importing';

/** Recorte de la bio: se elige por bio, no por parecido de nombre. */
const BIO_EXCERPT = 140;

function bioExcerpt(bio: string): string {
  const clean = bio.replace(/\s+/g, ' ').trim();
  return clean.length <= BIO_EXCERPT ? clean : `${clean.slice(0, BIO_EXCERPT - 1).trimEnd()}…`;
}

/**
 * El API ya habla inglés y `SessionImportError` distingue los cuatro fallos;
 * aquí solo se elige el encabezado de los dos que no se explican solos.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof SessionImportError) {
    if (cause.kind === 'gone') return 'That member no longer exists on The Session.';
    if (cause.kind === 'too-large') return 'That tunebook is too big to import at once.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export default function ImportFromSession(props: ImportFromSessionProps) {
  const [input, setInput] = createSignal('');
  const [members, setMembers] = createSignal<SessionMember[] | null>(null);
  const [tunes, setTunes] = createSignal<SessionTune[] | null>(null);
  const [busy, setBusy] = createSignal<Busy>('idle');
  const [page, setPage] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<TuneStatus>('playing_along');
  const [result, setResult] = createSignal<SessionImportResult | null>(null);

  const working = () => busy() !== 'idle';

  /** Qué añadir y qué ya está: puro y contra los `origin_ref` del repertorio. */
  const plan = createMemo(() => {
    const list = tunes();
    return list ? importPlan(list, props.existingRefs) : null;
  });

  const chosenBand = () => BANDS.find((band) => band.status === status()) ?? BANDS[0];

  const reset = () => {
    setMembers(null);
    setTunes(null);
    setPage(null);
    setProgress(null);
    setError(null);
    setResult(null);
  };

  const loadTunebook = async (memberId: number) => {
    setMembers(null);
    setPage('Reading page 1…');
    const loaded = await fetchTunebook(memberId, (pageRead) => {
      setPage(`Reading page ${pageRead.page} of ${pageRead.pages}…`);
    });
    setTunes(loaded);
    setPage(null);
  };

  /** Paso 1: id directo o, si no lo hay, el buscador de miembros. */
  const lookUp = async () => {
    const raw = input().trim();
    if (raw === '' || working()) return;

    reset();
    setBusy('looking');
    try {
      const memberId = parseMemberId(raw);
      if (memberId !== null) {
        await loadTunebook(memberId);
        return;
      }

      const found = await searchMembers(raw);
      setMembers(found);
      if (found.length === 0) setError('No member matches that name.');
    } catch (cause) {
      setPage(null);
      setError(messageFor(cause));
    } finally {
      setBusy('idle');
    }
  };

  /** Paso 2: elegido el miembro, su tunebook. */
  const chooseMember = async (member: SessionMember) => {
    if (working()) return;
    reset();
    setBusy('looking');
    try {
      await loadTunebook(member.id);
    } catch (cause) {
      setPage(null);
      setError(messageFor(cause));
    } finally {
      setBusy('idle');
    }
  };

  /** Paso 3: alta en lote. El panel no se cierra solo. */
  const runImport = async () => {
    const toAdd = plan()?.toAdd ?? [];
    if (toAdd.length === 0 || working()) return;

    setBusy('importing');
    setError(null);
    setResult(null);
    setProgress(`Adding 0 of ${toAdd.length}…`);

    try {
      const imported = await importSessionTunes(toAdd, status(), (done, total) => {
        setProgress(`Adding ${done} of ${total}…`);
      });
      setProgress(null);
      props.onImported();
      setResult(imported);
    } catch (cause) {
      setProgress(null);
      setError(messageFor(cause));
    } finally {
      setBusy('idle');
    }
  };

  /** «N tunes found · M already in your repertoire · K to add». */
  const summary = () => {
    const current = plan();
    if (!current || !tunes()) return null;
    const found = tunes()!.length;
    return `${found} ${found === 1 ? 'tune' : 'tunes'} found · ${current.alreadyPresent.length} already in your repertoire · ${current.toAdd.length} to add`;
  };

  return (
    <section class="import" aria-labelledby="import-heading" aria-busy={working()}>
      <h2 id="import-heading">Import from The Session</h2>
      <p class="hint">
        Your tunebook is read straight from thesession.org. Nothing is written until you
        import, and importing twice is safe — tunes you already have stay as they are.
      </p>

      <label for="session-member">Your The Session profile — number, link or name</label>
      <div class="row">
        <input
          id="session-member"
          type="text"
          autocomplete="off"
          placeholder="99727, https://thesession.org/members/99727 or your member name"
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void lookUp();
            }
          }}
        />
        <button
          type="button"
          class="act"
          disabled={working() || input().trim() === ''}
          onClick={() => void lookUp()}
        >
          {busy() === 'looking' ? 'Looking…' : 'Look up'}
        </button>
      </div>

      <Show when={page()}>
        <p class="progress" aria-live="polite">
          {page()}
        </p>
      </Show>

      <Show when={error()}>
        <p class="notice notice-error" role="alert">
          {error()}
        </p>
      </Show>

      {/* Candidatos del buscador: el nombre por sí solo no resuelve la ficha. */}
      <Show when={(members()?.length ?? 0) > 0}>
        <ul class="members">
          <For each={members()!}>
            {(member) => (
              <li>
                <div>
                  <p class="member-name">{member.name}</p>
                  <Show when={member.bio}>
                    <p class="member-bio">{bioExcerpt(member.bio!)}</p>
                  </Show>
                </div>
                <button
                  type="button"
                  class="pick"
                  disabled={working()}
                  onClick={() => void chooseMember(member)}
                >
                  This one
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={summary()}>
        <p class="summary">{summary()}</p>
        <Show when={(plan()?.toAdd.length ?? 0) === 0 && !result()}>
          <p class="hint">Nothing to import.</p>
        </Show>

        {/* El peldaño no viene en el tunebook: se elige aquí, y con la
            definición al lado — sin eso, 400 tunes en una sola banda. */}
        <label for="session-status">Add them as</label>
        <div class="row">
          <select
            id="session-status"
            value={status()}
            onChange={(event) => setStatus(event.currentTarget.value as TuneStatus)}
          >
            <For each={BANDS}>
              {(band) => <option value={band.status}>{STATUS_LABELS[band.status]}</option>}
            </For>
          </select>
          <button
            type="button"
            class="act"
            disabled={working() || (plan()?.toAdd.length ?? 0) === 0}
            onClick={() => void runImport()}
          >
            {busy() === 'importing'
              ? 'Importing…'
              : `Import ${plan()!.toAdd.length} ${plan()!.toAdd.length === 1 ? 'tune' : 'tunes'}`}
          </button>
        </div>
        <p class="rung-def">{chosenBand().definition}</p>

        <Show when={progress()}>
          <p class="progress" aria-live="polite">
            {progress()}
          </p>
        </Show>

        <Show when={result()}>
          <p class="done" role="status">
            {result()!.added} {result()!.added === 1 ? 'tune' : 'tunes'} added
            <Show when={result()!.alreadyPresent > 0}>
              {` · ${result()!.alreadyPresent} already there`}
            </Show>
          </p>
        </Show>
      </Show>

      <div class="foot">
        <button type="button" class="close" onClick={() => props.onClose()}>
          Close
        </button>
      </div>
    </section>
  );
}
