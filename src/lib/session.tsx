import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from 'solid-js';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { friendlyAuthError } from './format';

export interface AuthResult {
  error: string | null;
  notice?: string;
}

interface SessionContextValue {
  /** Sesión actual, o null si no hay. */
  session: Accessor<Session | null>;
  /** false hasta que getSession() ha respondido: evita parpadear el login. */
  ready: Accessor<boolean>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue>();

export const SessionProvider: ParentComponent = (props) => {
  const [session, setSession] = createSignal<Session | null>(null);
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setReady(true));

    // El callback corre dentro del lock de auth: solo se tocan señales, nunca se
    // llama a supabase desde aquí (provoca interbloqueo).
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });

    onCleanup(() => data.subscription.unsubscribe());
  });

  const value: SessionContextValue = {
    session,
    ready,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? friendlyAuthError(error.message) : null };
    },
    async signUp(email, password) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: friendlyAuthError(error.message) };
      if (!data.session) {
        return {
          error: null,
          notice: 'Account created, but this project still asks for email confirmation.',
        };
      }
      return { error: null };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
};

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
