// @vitest-environment node
/**
 * Integración real de `logPractice` contra Supabase (#10).
 *
 * `practice.test.ts` prueba la compensación con el cliente simulado; esto es el
 * otro extremo: el adaptador hablando con PostgREST de verdad, con una cuenta
 * efímera y su JWT. Se salta sola si no hay credenciales, así que la suite
 * normal sigue sin red:
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE=… \
 *     npx vitest run src/lib/practice.integration.test.ts
 *
 * Lo que comprueba, y que ningún mock puede comprobar:
 *   1. `insert({})` en `pr_sessions` funciona sin cuerpo (user_id y started_at
 *      los pone la base) y devuelve el id.
 *   2. El trigger mueve `pr_repertoire.last_practiced_at` al insertar la línea.
 *   3. Si la línea falla por RLS (repertorio ajeno), NO queda una sesión vacía:
 *      la compensación borra la sesión recién creada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabase } from './supabase';
import { logPractice } from './practice';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
const enabled = Boolean(url && anon && serviceRole);

const stamp = Math.random().toString(36).slice(2, 10);
const email = `probe-practice-${stamp}@example.com`;
const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;

let userId: string | null = null;
let tuneId: string | null = null;
let repertoireId: string | null = null;

/** Operaciones de administración: solo el alta y la baja del usuario de prueba. */
async function admin(path: string, method: string, body?: unknown) {
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRole!,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

describe.skipIf(!enabled)('logPractice contra Supabase real', () => {
  beforeAll(async () => {
    const created = await admin('admin/users', 'POST', {
      email,
      password,
      email_confirm: true,
    });
    expect(created.status).toBe(200);
    userId = created.data.id;

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();

    const { data: tune, error: tuneError } = await supabase
      .from('pr_tunes')
      .insert({
        origin: 'thesession',
        origin_ref: `probe-practice-${stamp}`,
        name: 'Probe Practice Tune',
        rhythm: 'jig',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(tuneError).toBeNull();
    tuneId = tune!.id;

    const { data: row, error: rowError } = await supabase
      .from('pr_repertoire')
      .insert({ tune_id: tuneId })
      .select('id')
      .single();
    expect(rowError).toBeNull();
    repertoireId = row!.id;
  }, 30_000);

  afterAll(async () => {
    // El borrado del usuario arrastra repertorio y sesiones; la tune queda con
    // created_by = null y se borra aparte, solo la de esta prueba.
    if (userId) await admin(`admin/users/${userId}`, 'DELETE');
    if (tuneId) {
      await fetch(`${url}/rest/v1/pr_tunes?id=eq.${tuneId}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceRole!,
          Authorization: `Bearer ${serviceRole}`,
          Prefer: 'return=minimal',
        },
      });
    }
    await supabase.auth.signOut();
  }, 30_000);

  it('apunta el ensayo y mueve last_practiced_at', async () => {
    const before = await supabase
      .from('pr_repertoire')
      .select('last_practiced_at')
      .eq('id', repertoireId!)
      .single();
    expect(before.data!.last_practiced_at).toBeNull();

    await logPractice(repertoireId!, { quality: 4, comment: '  primera prueba real  ' });

    const after = await supabase
      .from('pr_repertoire')
      .select('last_practiced_at')
      .eq('id', repertoireId!)
      .single();
    expect(after.data!.last_practiced_at).not.toBeNull();

    const { data: lines, error } = await supabase
      .from('pr_session_tunes')
      .select('quality, comment, session_id')
      .eq('repertoire_id', repertoireId!);
    expect(error).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines![0].quality).toBe(4);
    // El recorte es del cliente: a la base no llega el relleno.
    expect(lines![0].comment).toBe('primera prueba real');
  }, 30_000);

  it('guarda sin calidad (opcional) y sin comentario', async () => {
    await logPractice(repertoireId!, { quality: null, comment: '   ' });

    const { data: lines } = await supabase
      .from('pr_session_tunes')
      .select('quality, comment')
      .eq('repertoire_id', repertoireId!)
      .is('quality', null);
    expect(lines).toHaveLength(1);
    expect(lines![0].comment).toBeNull();
  }, 30_000);

  it('no deja sesión vacía cuando la línea falla por RLS', async () => {
    const ghostRepertoire = crypto.randomUUID();
    const sessionsBefore = await supabase
      .from('pr_sessions')
      .select('id', { count: 'exact', head: true });

    await expect(
      logPractice(ghostRepertoire, { quality: 3, comment: null })
    ).rejects.toThrow(/Could not save the practice/);

    const sessionsAfter = await supabase
      .from('pr_sessions')
      .select('id', { count: 'exact', head: true });
    // Ni una sesión más: la que se creó para la línea imposible ya no está.
    expect(sessionsAfter.count).toBe(sessionsBefore.count);
  }, 30_000);
});
