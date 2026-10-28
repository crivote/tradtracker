-- 004 — Registro de ensayos (F4, primer corte: esquema y trigger)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- Una fila de `pr_sessions` es una sesión de práctica; `pr_session_tunes` guarda
-- qué tunes se practicaron en ella. El «botón de añadir ensayo» crea una sesión
-- con un solo tune: no hay un camino corto con otra forma de dato, para que el
-- historial (por tune y por sesión) se calcule siempre igual.
--
-- Lo retroactivo («ayer practiqué estos cinco») es una sesión con `started_at` en
-- el pasado: NO se añade una segunda columna de fecha que pueda contradecirla.
--
-- RLS activada en la misma migración que crea cada tabla.

-- ─────────────────────────────────────────────────────────────
-- pr_sessions — una sesión de práctica del usuario
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists pr_sessions_user_time_idx
  on public.pr_sessions (user_id, started_at desc);

alter table public.pr_sessions enable row level security;

drop policy if exists pr_sessions_all on public.pr_sessions;
create policy pr_sessions_all on public.pr_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- pr_session_tunes — qué se practicó en cada sesión
-- `quality` es opcional a propósito: apuntar el ensayo no debe exigir puntuarlo.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_session_tunes (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.pr_sessions (id) on delete cascade,
  repertoire_id uuid not null references public.pr_repertoire (id) on delete cascade,
  quality       smallint check (quality is null or quality between 1 and 5),
  comment       text,
  position      smallint not null default 0,
  created_at    timestamptz not null default now(),
  unique (session_id, repertoire_id)
);

create index if not exists pr_session_tunes_session_idx
  on public.pr_session_tunes (session_id);

create index if not exists pr_session_tunes_repertoire_idx
  on public.pr_session_tunes (repertoire_id, created_at desc);

alter table public.pr_session_tunes enable row level security;

-- El dueño de la fila lo decide la sesión, no el navegador: solo se puede
-- escribir en sesiones propias y sobre filas del propio repertorio.
drop policy if exists pr_session_tunes_all on public.pr_session_tunes;
create policy pr_session_tunes_all on public.pr_session_tunes
  for all to authenticated
  using (
    exists (
      select 1 from public.pr_sessions s
       where s.id = pr_session_tunes.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.pr_sessions s
       where s.id = pr_session_tunes.session_id and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.pr_repertoire r
       where r.id = pr_session_tunes.repertoire_id and r.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- last_practiced_at se mantiene desde la base, no desde el cliente
-- `greatest` evita que apuntar un ensayo viejo (retroactivo) mueva la fecha
-- hacia atrás: la última práctica es la más reciente de las registradas.
-- ─────────────────────────────────────────────────────────────
create or replace function public.pr_session_tunes_touch()
returns trigger
language plpgsql
as $$
declare
  v_user    uuid;
  v_started timestamptz;
begin
  select s.user_id, s.started_at
    into v_user, v_started
    from public.pr_sessions s
   where s.id = new.session_id;

  if v_user is null or v_started is null then
    return new;
  end if;

  update public.pr_repertoire r
     set last_practiced_at = greatest(coalesce(r.last_practiced_at, v_started), v_started)
   where r.id = new.repertoire_id
     and r.user_id = v_user;

  return new;
end;
$$;

drop trigger if exists pr_session_tunes_touch_trg on public.pr_session_tunes;
create trigger pr_session_tunes_touch_trg
  after insert or update on public.pr_session_tunes
  for each row execute function public.pr_session_tunes_touch();
