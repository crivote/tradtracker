import { Show, createSignal } from 'solid-js';
import { useSession } from '../lib/session';

type Mode = 'signin' | 'signup';

/**
 * Login y registro en una sola tarjeta. Recuperación de contraseña queda fuera de
 * alcance por decisión del propietario (2026-10-28): el SMTP por defecto del plan
 * free entrega 2 correos/hora, insuficiente para un flujo de recuperación público.
 */
export default function Login() {
  const session = useSession();
  const [mode, setMode] = createSignal<Mode>('signin');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;

    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result =
        mode() === 'signin'
          ? await session.signIn(email().trim(), password())
          : await session.signUp(email().trim(), password());

      setError(result.error);
      if (result.notice) setNotice(result.notice);
      if (!result.error && !result.notice) setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="max-w-md mx-auto">
      <div class="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div class="flex gap-1 mb-6 rounded bg-gray-900 p-1">
          <button
            type="button"
            class="flex-1 rounded px-3 py-2 text-sm font-medium transition"
            classList={{
              'bg-amber-500 text-gray-900': mode() === 'signin',
              'text-gray-400 hover:text-gray-200': mode() !== 'signin',
            }}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            class="flex-1 rounded px-3 py-2 text-sm font-medium transition"
            classList={{
              'bg-amber-500 text-gray-900': mode() === 'signup',
              'text-gray-400 hover:text-gray-200': mode() !== 'signup',
            }}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1" for="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autocomplete="email"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
              class="w-full rounded bg-gray-900 border border-gray-600 px-3 py-2 text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-sm text-gray-300 mb-1" for="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autocomplete={mode() === 'signin' ? 'current-password' : 'new-password'}
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              class="w-full rounded bg-gray-900 border border-gray-600 px-3 py-2 text-gray-100 focus:border-amber-500 focus:outline-none"
            />
            <p class="mt-1 text-xs text-gray-500">At least 6 characters.</p>
          </div>

          <Show when={error()}>
            <p class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200" role="alert">
              {error()}
            </p>
          </Show>

          <Show when={notice()}>
            <p class="rounded border border-amber-800 bg-amber-900/40 px-3 py-2 text-sm text-amber-200">
              {notice()}
            </p>
          </Show>

          <button
            type="submit"
            disabled={busy()}
            class="w-full rounded bg-amber-500 px-3 py-2 font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-60"
          >
            {busy() ? 'Working…' : mode() === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p class="mt-4 text-xs text-gray-500">
          Password recovery is not available yet on this instance.
        </p>
      </div>
    </div>
  );
}
