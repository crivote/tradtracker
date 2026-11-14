-- 017_practice_by_day.sql
-- Paso 1 de #56: ADITIVO. Crea la tabla de marcas por tune y día y la deja llena, sin tocar el modelo de
-- sesiones ni el cliente. La app desplegada sigue escribiendo en `pr_sessions` y leyendo
-- `pr_repertoire.last_practiced_at`; nada de lo que hay aquí la afecta.
--
-- El corte se parte en tres migraciones para no abrir una ventana rota:
--   017 (esta)  añade `pr_practice` + `last_practiced_day` y rellena, en paralelo a las sesiones.
--   código      el cliente pasa a escribir y leer lo nuevo (despliegue verificado).
--   018         limpia: renombra `pr_sessions*` a `_legacy` y retira `last_practiced_at`.
--
-- Idempotente: se puede reejecutar tras un fallo parcial.

-- ── 1. La tabla de marcas ──────────────────────────────────────────────────
create table if not exists public.pr_practice (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  repertoire_id uuid not null references public.pr_repertoire(id) on delete cascade,
  day           date not null,                        -- día LOCAL, lo escribe el cliente
  practiced_at  timestamptz not null default now(),   -- instante real; no se pierde
  quality       smallint check (quality between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now(),
  unique (user_id, repertoire_id, day)
);

create index if not exists pr_practice_rep_idx
  on public.pr_practice (repertoire_id, day desc);

create index if not exists pr_practice_user_day_idx
  on public.pr_practice (user_id, day desc);

alter table public.pr_practice enable row level security;

drop policy if exists pr_practice_all on public.pr_practice;
create policy pr_practice_all on public.pr_practice
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 2. El último ensayo, en días locales ───────────────────────────────────
-- Se añade en paralelo: mientras el cliente viejo siga escribiendo sesiones, esta columna se mantiene
-- derivada de `last_practiced_at` y las dos fuentes coinciden.
alter table public.pr_repertoire add column if not exists last_practiced_day date;

update public.pr_repertoire
   set last_practiced_day = (last_practiced_at at time zone 'Europe/Madrid')::date
 where last_practiced_at is not null
   and last_practiced_day is null;

create or replace function public.pr_repertoire_day_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.last_practiced_at is not null then
      new.last_practiced_day := (new.last_practiced_at at time zone 'Europe/Madrid')::date;
    end if;
    return new;
  end if;

  if new.last_practiced_at is distinct from old.last_practiced_at then
    new.last_practiced_day := (new.last_practiced_at at time zone 'Europe/Madrid')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists pr_repertoire_day_sync_trg on public.pr_repertoire;

create trigger pr_repertoire_day_sync_trg
  before insert or update on public.pr_repertoire
  for each row execute function public.pr_repertoire_day_sync();

-- ── 3. Escribir una marca mueve el último ensayo, sin retroceder ───────────
create or replace function public.pr_practice_touch()
returns trigger
language plpgsql
as $$
begin
  update public.pr_repertoire
     set last_practiced_at = greatest(coalesce(last_practiced_at, new.practiced_at), new.practiced_at)
   where id = new.repertoire_id;
  return new;
end;
$$;

drop trigger if exists pr_practice_touch_trg on public.pr_practice;

create trigger pr_practice_touch_trg
  after insert or update on public.pr_practice
  for each row execute function public.pr_practice_touch();

-- ── 4. Backfill desde las líneas de sesión ─────────────────────────────────
-- 135 líneas → 134 marcas: las dos líneas que comparten (tune, día) se funden, que es justo la regla nueva.
-- Conserva el instante real y la valoración; el comentario del último gana y una valoración nula no borra
-- la que había.
--
-- La deduplicación va en el SELECT, no en el ON CONFLICT: `ON CONFLICT DO UPDATE` no admite dos filas
-- propuestas con la misma clave en una sola sentencia (21000, «cannot affect row a second time»), y aquí
-- hay un par real que la produce.
with src as (
  select s.user_id,
         st.repertoire_id,
         (s.started_at at time zone 'Europe/Madrid')::date as day,
         s.started_at,
         st.quality,
         st.comment
  from public.pr_session_tunes st
  join public.pr_sessions s on s.id = st.session_id
), agg as (
  select user_id,
         repertoire_id,
         day,
         max(started_at) as practiced_at,
         (array_agg(quality order by started_at desc) filter (where quality is not null))[1] as quality,
         (array_agg(comment order by started_at desc)
            filter (where nullif(btrim(coalesce(comment, '')), '') is not null))[1] as comment
  from src
  group by user_id, repertoire_id, day
)
insert into public.pr_practice (user_id, repertoire_id, day, practiced_at, quality, comment, created_at)
select user_id, repertoire_id, day, practiced_at, quality, comment, practiced_at
from agg
on conflict (user_id, repertoire_id, day) do update
  set quality      = coalesce(excluded.quality, public.pr_practice.quality),
      comment      = coalesce(excluded.comment, public.pr_practice.comment),
      practiced_at = greatest(public.pr_practice.practiced_at, excluded.practiced_at);

-- ── 5. Recalcular el último ensayo al borrar una marca ─────────────────────
-- `pr_practice_touch` solo mueve la fecha hacia delante; si se borra la marca más reciente hay que
-- recalcular. La función existente (009) recalcula desde `pr_session_tunes`, que es la fuente vieja, así
-- que hace falta una nueva que lea `pr_practice`. Se añade con nombre distinto para no romper el cliente
-- desplegado durante la ventana; la vieja se retira en 018.
create or replace function public.pr_recompute_last_practice(p_repertoire_id uuid)
returns void
language plpgsql
as $$
begin
  update public.pr_repertoire r
     set last_practiced_at = (
           select max(p.practiced_at)
             from public.pr_practice p
            where p.repertoire_id = r.id
         )
   where r.id = p_repertoire_id;
end;
$$;
