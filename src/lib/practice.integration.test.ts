// @vitest-environment node
/**
 * Integración real de `logPractice` contra Supabase (#10; unidad de día en #56).
 *
 * `practice.test.ts` prueba el adaptador con el cliente simulado; esto es el otro
 * extremo: PostgREST de verdad, con una cuenta efímera y su JWT. Se salta sola si
 * no hay credenciales, así que la suite normal sigue sin red:
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE=… \
 *     npx vitest run src/lib/practice.integration.test.ts
 *
 * Lo que comprueba, y que ningún mock puede comprobar:
 *   1. El `upsert` sobre `pr_practice` con `onConflict (user_id, repertoire_id,
 *      day)` funciona **sin mandar `user_id`**: lo pone la base.
 *   2. Marcar otra vez el mismo día **actualiza** la misma fila: una, no dos.
 *   3. El trigger mueve `pr_repertoire.last_practiced_at` y su `last_practiced_day`.
 *   4. Borrar la marca y llamar a `pr_recompute_last_practice` deja la fecha
 *      atrás: la RPC nueva, la que lee marcas y no sesiones.
 *   5. Si la escritura falla por RLS (repertorio ajeno), no queda ninguna fila.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabase } from './supabase';
import { logPractice, unmarkPractice } from './practice';
import { todayKeyFor } from './practice-storage';

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
    // El borrado del usuario arrastra repertorio y marcas; la tune queda con
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

  it('apunta la marca del día, mueve la fecha y el segundo toque del día la actualiza', async () => {
    const day = todayKeyFor(Date.now());

    const before = await supabase
      .from('pr_repertoire')
      .select('last_practiced_at,last_practiced_day')
      .eq('id', repertoireId!)
      .single();
    expect(before.data!.last_practiced_at).toBeNull();
    expect(before.data!.last_practiced_day).toBeNull();

    const id = await logPractice(repertoireId!, { quality: 4, comment: '  primera prueba real  ' });
    expect(typeof id).toBe('string');

    const after = await supabase
      .from('pr_repertoire')
      .select('last_practiced_at,last_practiced_day')
      .eq('id', repertoireId!)
      .single();
    expect(after.data!.last_practiced_at).not.toBeNull();
    // El día es el local que compuso el cliente, no el que saldría del instante.
    expect(after.data!.last_practiced_day).toBe(day);

    const { data: marks, error } = await supabase
      .from('pr_practice')
      .select('id,day,quality,comment')
      .eq('repertoire_id', repertoireId!);
    expect(error).toBeNull();
    expect(marks).toHaveLength(1);
    expect(marks![0].id).toBe(id);
    expect(marks![0].day).toBe(day);
    expect(marks![0].quality).toBe(4);
    // El recorte es del cliente: a la base no llega el relleno.
    expect(marks![0].comment).toBe('primera prueba real');

    // El mismo día, otra vez: el `unique (user_id, repertoire_id, day)` convierte
    // el segundo toque en una actualización —una fila, la del último—.
    await logPractice(repertoireId!, { quality: 2, comment: '  segunda pasada  ' });

    const { data: again, error: againError } = await supabase
      .from('pr_practice')
      .select('quality,comment')
      .eq('repertoire_id', repertoireId!);
    expect(againError).toBeNull();
    expect(again).toHaveLength(1);
    expect(again![0].quality).toBe(2);
    expect(again![0].comment).toBe('segunda pasada');
  }, 30_000);

  it('borrar la marca y recalcular deja la fecha atrás', async () => {
    await unmarkPractice(repertoireId!, todayKeyFor(Date.now()));

    const { data: marks } = await supabase
      .from('pr_practice')
      .select('id')
      .eq('repertoire_id', repertoireId!);
    expect(marks).toHaveLength(0);

    const { data: row } = await supabase
      .from('pr_repertoire')
      .select('last_practiced_at,last_practiced_day')
      .eq('id', repertoireId!)
      .single();
    // Sin marcas, el recálculo deja null: la fecha retrocede de verdad.
    expect(row!.last_practiced_at).toBeNull();
    expect(row!.last_practiced_day).toBeNull();
  }, 30_000);

  it('guarda sin calidad y no deja marca de un repertorio ajeno (RLS)', async () => {
    await logPractice(repertoireId!, { quality: null, comment: '   ' });

    const { data: marks } = await supabase
      .from('pr_practice')
      .select('quality,comment')
      .eq('repertoire_id', repertoireId!)
      .is('quality', null);
    expect(marks).toHaveLength(1);
    expect(marks![0].comment).toBeNull();

    const ghostRepertoire = crypto.randomUUID();
    const before = await supabase
      .from('pr_practice')
      .select('id', { count: 'exact', head: true });

    await expect(
      logPractice(ghostRepertoire, { quality: 3, comment: null }),
    ).rejects.toThrow(/Could not save the practice/);

    const after = await supabase
      .from('pr_practice')
      .select('id', { count: 'exact', head: true });
    // Ni una fila más: la marca de un repertorio ajeno no entra.
    expect(after.count).toBe(before.count);
  }, 30_000);
});
