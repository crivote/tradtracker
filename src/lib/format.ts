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

/**
 * Días enteros desde un instante ISO hasta `now`.
 *
 * El instante de referencia se inyecta: con el `Date.now()` interno la función
 * no era determinista y los tests dependían del reloj de la máquina. Una fecha
 * futura (reloj desajustado, husos) cuenta como 0: nunca se devuelve negativo,
 * porque «-2 days ago» no significa nada para quien practica.
 */
export function daysSince(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * Instante de la medianoche **local** del día `YYYY-MM-DD`.
 *
 * `Date.parse('2026-11-13')` y `new Date('2026-11-13')` leen la fecha como UTC
 * medianoche (lo dice la norma), así que en Madrid el día empieza a las 01:00 y
 * a las 23:30 se cuentan dos días distintos según el huso. Las fechas de ensayo
 * (`pr_practice.day`, `pr_repertoire.last_practiced_day`) son días locales, y
 * solo se pueden convertir con el constructor local.
 *
 * `NaN` si el texto no tiene la forma `YYYY-MM-DD`: quien llama decide qué
 * hacer con una fecha ilegible, no se inventa un día.
 */
export function parseLocalDay(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return Number.NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

/**
 * Días locales enteros entre un día `YYYY-MM-DD` y `now`.
 *
 * Se cuenta por medianoches locales, no por milisegundos del instante: un
 * ensayo de las 23:30 del día 10 es el día 10, y a las 00:30 del 11 ya es el 11.
 * El redondeo absorbe los días de cambio de hora (23 o 25 horas), que una resta
 * de 86 400 000 ms convertiría en un día de más o de menos. Nunca negativo, por
 * lo mismo que `daysSince`.
 */
export function daysSinceDay(day: string | null, now: number = Date.now()): number | null {
  if (!day) return null;
  const then = parseLocalDay(day);
  if (Number.isNaN(then)) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - then) / 86_400_000));
}

/**
 * Un día local `YYYY-MM-DD` como fecha legible, con el formato corto del resto
 * de la app. Sin día —o ilegible— devuelve el guion de los huecos.
 */
export function formatDay(day: string | null): string {
  if (!day) return '—';
  const ms = parseLocalDay(day);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
