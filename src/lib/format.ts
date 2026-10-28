/**
 * Utilidades de presentación y traducción de errores de Supabase Auth.
 * Puras a propósito: son lo que las pruebas unitarias cubren sin red.
 */

/**
 * TheSession nombra muchos tunes como «Kesh, The». Para mostrarlos se mueve el
 * artículo delante, que es como se dicen en la sesión.
 */
export function normalizeTitle(name: string): string {
  const match = name.match(/^(.*?),\s*(The|A|An|Na|An)\s*$/i);
  if (!match) return name;
  return `${match[2]} ${match[1]}`;
}

const AUTH_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Wrong email or password'],
  [/email not confirmed/i, 'Confirm your email address before signing in'],
  [/user already registered/i, 'That email already has an account — try signing in'],
  [/password should be at least (\d+) characters/i, 'Password must be at least $1 characters'],
  [/unable to validate email address/i, 'That email address does not look valid'],
  [/signups not allowed|signup is disabled/i, 'Sign-ups are closed on this project'],
  [/rate limit|too many requests/i, 'Too many attempts. Wait a minute and try again'],
  [/new row violates row-level security/i, 'The database refused the operation (RLS): the row is not yours'],
];

/**
 * Traduce los mensajes de Supabase a algo que un humano pueda accionar. El punto
 * final se normaliza: Supabase lo incluye en unos mensajes y no en otros, y sin
 * esto salían dos («...characters..»).
 */
export function friendlyAuthError(message: string): string {
  const cleaned = message.trim().replace(/\.$/, '');
  for (const [pattern, text] of AUTH_MESSAGES) {
    if (pattern.test(cleaned)) {
      const replaced = cleaned.replace(pattern, text);
      return `${replaced.charAt(0).toUpperCase()}${replaced.slice(1)}.`;
    }
  }
  return message;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}
