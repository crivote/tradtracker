-- 001 — Esquema inicial de tradtracker
-- Proyecto Supabase: msysmkaqmefvyemzqftf (eu-central-1), hermano del de TradTube (decisión D1).
-- Identidad propia de tune (D4): pr_tunes.id uuid + origin/origin_ref.
-- RLS activada en el mismo movimiento que la creación de cada tabla.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- pr_tunes — definición compartida del tune (no datos personales)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_tunes (
  id          uuid primary key default gen_random_uuid(),
  origin      text not null default 'thesession',
  origin_ref  text,
  name        text not null,
  rhythm      text,
  meter       text,
  key         text,
  abc         text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists pr_tunes_origin_ref_key
  on public.pr_tunes (origin, origin_ref);

alter table public.pr_tunes enable row level security;

drop policy if exists pr_tunes_select on public.pr_tunes;
create policy pr_tunes_select on public.pr_tunes
  for select to authenticated
  using (true);

drop policy if exists pr_tunes_insert on public.pr_tunes;
create policy pr_tunes_insert on public.pr_tunes
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists pr_tunes_update on public.pr_tunes;
create policy pr_tunes_update on public.pr_tunes
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists pr_tunes_delete on public.pr_tunes;
create policy pr_tunes_delete on public.pr_tunes
  for delete to authenticated
  using (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- pr_repertoire — lo personal: un tune en el repertorio de un usuario
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_repertoire (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  tune_id           uuid not null references public.pr_tunes (id) on delete cascade,
  custom_title      text,
  custom_rhythm     text,
  custom_key        text,
  custom_abc        text,
  status            text not null default 'nueva'
                      check (status in ('nueva','aprendiendo','media','afianzada','aparcada')),
  rating            smallint check (rating between 1 and 5),
  image_path        text,
  notes             text,
  added_at          timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  last_practiced_at timestamptz,
  unique (user_id, tune_id)
);

create index if not exists pr_repertoire_user_idx on public.pr_repertoire (user_id);
create index if not exists pr_repertoire_urgency_idx
  on public.pr_repertoire (user_id, status, last_practiced_at);

alter table public.pr_repertoire enable row level security;

drop policy if exists pr_repertoire_all on public.pr_repertoire;
create policy pr_repertoire_all on public.pr_repertoire
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Mantener status_changed_at coherente sin depender del cliente
-- ─────────────────────────────────────────────────────────────
create or replace function public.pr_repertoire_touch()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pr_repertoire_touch_trg on public.pr_repertoire;
create trigger pr_repertoire_touch_trg
  before update on public.pr_repertoire
  for each row execute function public.pr_repertoire_touch();
