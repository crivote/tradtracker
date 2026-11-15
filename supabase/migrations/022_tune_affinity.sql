-- 022 — Afinidad precalculada entre tunes (#61)
--
-- «Si te gusta esta, aprende esta otra» no se calcula en vivo. La señal está
-- publicada en el volcado de TheSession: las tunes que la gente toca juntas
-- (132.757 sets) y las que comparten disco (7.699 grabaciones). Medido el
-- 2026-11-15 sobre las 478 tunes del repertorio: 21.245 pares en sets (14.298 en
-- dos o más) y 39.429 en grabaciones.
--
-- Un descriptor melódico se probó antes y **no** sirvió: n-gramas de intervalos,
-- mediana de similitud 0,048 y un solo par por encima de 0,3 (detalle en la skill
-- del proyecto). Por eso esta tabla sale de la coocurrencia, no de un hash.
--
-- Se guardan los dos sentidos (a→b y b→a) para que la ficha lea su top sin OR.
-- Solo las tunes que existen en `pr_tunes`; la carga va con service_role.
--
-- Idempotente: se puede reaplicar.

create table if not exists public.pr_tune_affinity (
  tune_id uuid not null references public.pr_tunes(id) on delete cascade,
  related_tune_id uuid not null references public.pr_tunes(id) on delete cascade,
  -- Apariciones juntas. `sets` pesa más que `recordings`: tocar juntas es una
  -- señal más fuerte que coincidir en un disco.
  sets smallint not null default 0,
  recordings smallint not null default 0,
  score integer generated always as (3 * sets + recordings) stored,
  updated_at timestamptz not null default now(),
  primary key (tune_id, related_tune_id),
  constraint pr_tune_affinity_no_self check (tune_id <> related_tune_id)
);

comment on table public.pr_tune_affinity is
  'Afinidad precalculada desde los sets y las grabaciones del volcado de TheSession. score = 3*sets + recordings. Top-10 por tune; no se calcula en vivo.';
comment on column public.pr_tune_affinity.sets is
  'Número de sets de TheSession en los que aparecen juntas las dos tunes.';
comment on column public.pr_tune_affinity.recordings is
  'Número de grabaciones en las que aparecen juntas.';

-- El top por tune es la consulta caliente de la ficha.
create index if not exists pr_tune_affinity_top_idx
  on public.pr_tune_affinity (tune_id, score desc);
create index if not exists pr_tune_affinity_related_idx
  on public.pr_tune_affinity (related_tune_id);

alter table public.pr_tune_affinity enable row level security;

-- Catálogo: todos leen, nadie escribe desde el cliente (la carga es del servidor).
drop policy if exists pr_tune_affinity_select on public.pr_tune_affinity;
create policy pr_tune_affinity_select on public.pr_tune_affinity
  for select to authenticated using (true);
