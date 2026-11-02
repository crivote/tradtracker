-- 012_tags.sql — F17: etiquetas por facetas (tradition / technique / mood)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- Vocabulario CERRADO y COMÚN; asignaciones PERSONALES por (usuario, tune).
-- `tradition` admite jerarquía de UN nivel (donegal → ireland): la granularidad
-- se expresa por jerarquía, no por una faceta `region:` aparte.
--
-- El anclaje es (user_id, tune_id) y NO `repertoire_id` a propósito: una etiqueta
-- es conocimiento sobre la pieza, y quitar la tune del repertorio (#45) borra
-- repertorio e historial pero no debe llevarse años de clasificación.
--
-- Idempotente: reaplicable.

-- ─────────────────────────────────────────────────────────────
-- Vocabulario
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_tag_facets (
  id        text primary key,            -- 'tradition' | 'technique' | 'mood'
  label     text not null,               -- lo que se pinta (la UI va en inglés)
  multiple  boolean not null default true,
  sort      int not null default 0
);

create table if not exists public.pr_tags (
  id     serial primary key,
  facet  text not null references public.pr_tag_facets (id) on delete cascade,
  value  text not null,                  -- slug canónico: 'sliabh_luchra'
  label  text not null,                  -- 'Sliabh Luachra'
  parent int references public.pr_tags (id) on delete restrict,  -- un solo nivel
  sort   int not null default 0,
  unique (facet, value)
);

create index if not exists pr_tags_facet_idx on public.pr_tags (facet, parent, sort);

-- ─────────────────────────────────────────────────────────────
-- Asignaciones (personales)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pr_user_tune_tags (
  user_id   uuid not null references auth.users (id) on delete cascade,
  tune_id   uuid not null references public.pr_tunes (id) on delete cascade,
  tag_id    int  not null references public.pr_tags (id) on delete cascade,
  -- Tri-estado reservado para etiquetas COMPARTIDAS (v2): sin él, quitar una
  -- etiqueta comunitaria es imposible, vuelve en la siguiente lectura.
  dismissed boolean not null default false,
  primary key (user_id, tune_id, tag_id)
);

create index if not exists pr_user_tune_tags_lookup_idx
  on public.pr_user_tune_tags (user_id, tune_id) where not dismissed;

alter table public.pr_tag_facets     enable row level security;
alter table public.pr_tags           enable row level security;
alter table public.pr_user_tune_tags enable row level security;

-- El vocabulario lo lee todo usuario autenticado y NO lo escribe nadie desde el cliente.
drop policy if exists pr_tag_facets_select on public.pr_tag_facets;
create policy pr_tag_facets_select on public.pr_tag_facets
  for select to authenticated using (true);

drop policy if exists pr_tags_select on public.pr_tags;
create policy pr_tags_select on public.pr_tags
  for select to authenticated using (true);

-- Las asignaciones son del dueño.
drop policy if exists pr_user_tune_tags_all on public.pr_user_tune_tags;
create policy pr_user_tune_tags_all on public.pr_user_tune_tags
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Asignar etiquetas sembrando sus ancestros, en UNA llamada para N tunes.
-- `security definer` es deliberado: escribe varias filas por tune en una
-- transacción y fija `user_id = auth.uid()` explícitamente, así que no puede
-- escribir filas ajenas. No es un oráculo de ids.
-- `union` (no `union all`) corta ciclos.
-- ─────────────────────────────────────────────────────────────
create or replace function public.pr_tag_with_ancestors(p_tune_ids uuid[], p_tag_ids int[])
returns int
language sql
security definer
set search_path = public
as $$
  with recursive arbol as (
    select id, parent from public.pr_tags where id = any(p_tag_ids)
    union
    select t.id, t.parent from public.pr_tags t join arbol a on t.id = a.parent
  ), ins as (
    insert into public.pr_user_tune_tags (user_id, tune_id, tag_id)
    select auth.uid(), u.tune_id, a.id
      from unnest(p_tune_ids) as u(tune_id)
      cross join arbol a
    on conflict (user_id, tune_id, tag_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

revoke all on function public.pr_tag_with_ancestors(uuid[], int[]) from public;
grant execute on function public.pr_tag_with_ancestors(uuid[], int[]) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Semilla (ampliable: añadir un valor es una línea de insert)
-- ─────────────────────────────────────────────────────────────
insert into public.pr_tag_facets (id, label, multiple, sort) values
  ('tradition', 'Tradition', true, 1),
  ('technique', 'Technique', true, 2),
  ('mood',      'Mood',      true, 3)
on conflict (id) do nothing;

insert into public.pr_tags (facet, value, label, sort) values
  ('tradition', 'ireland',       'Ireland',       1),
  ('tradition', 'scotland',      'Scotland',      2),
  ('tradition', 'galicia',       'Galicia',       3),
  ('tradition', 'asturias',      'Asturias',      4),
  ('tradition', 'brittany',      'Brittany',      5),
  ('tradition', 'wales',         'Wales',         6),
  ('tradition', 'england',       'England',       7),
  ('tradition', 'manx',          'Manx',          8),
  ('tradition', 'quebec',        'Québec',        9),
  ('tradition', 'appalachia',    'Appalachia',   10)
on conflict (facet, value) do nothing;

-- Hijos: `donegal` y `sliabh_luchra` NO son hermanos de `scotland`, son estilos
-- regionales dentro de Irlanda. `appalachia` se queda como raíz porque desciende
-- de lo irlandés y lo escocés a la vez.
insert into public.pr_tags (facet, value, label, parent, sort)
select 'tradition', v.value, v.label, (select id from public.pr_tags where facet = 'tradition' and value = v.parent), v.sort
  from (values
    ('donegal',       'Donegal',       'ireland',  11),
    ('sliabh_luchra', 'Sliabh Luachra', 'ireland', 12),
    ('clare',         'Clare',         'ireland',  13),
    ('galway',        'Galway',        'ireland',  14),
    ('sligo',         'Sligo',         'ireland',  15),
    ('kerry',         'Kerry',         'ireland',  16),
    ('shetland',      'Shetland',      'scotland', 17),
    ('orkney',        'Orkney',        'scotland', 18),
    ('cape_breton',   'Cape Breton',   'scotland', 19)
  ) as v(value, label, parent, sort)
on conflict (facet, value) do nothing;

insert into public.pr_tags (facet, value, label, sort) values
  ('technique', 'third_position',  'Third position',  1),
  ('technique', 'key_change',      'Key change',      2),
  ('technique', 'c_natural',       'C natural',       3),
  ('technique', 'double_stops',    'Double stops',    4),
  ('technique', 'string_crossing', 'String crossing', 5),
  ('technique', 'rolls',           'Rolls',           6),
  ('technique', 'crans',           'Crans',           7),
  ('technique', 'cuts',            'Cuts',            8),
  ('technique', 'triplets',        'Triplets',        9),
  ('technique', 'octave_jump',     'Octave jump',    10),
  ('mood',      'melancholy',      'Melancholy',      1),
  ('mood',      'driving',         'Driving',         2),
  ('mood',      'gentle',          'Gentle',          3),
  ('mood',      'celebratory',     'Celebratory',     4),
  ('mood',      'wistful',         'Wistful',         5),
  ('mood',      'lonesome',        'Lonesome',        6)
on conflict (facet, value) do nothing;

-- Invariantes del árbol, verificados (no hay CHECK posible entre filas):
--   · profundidad máxima 2: un hijo no puede tener padre con padre.
--   · sin ciclos: lo corta `union` en la función, y aquí la profundidad.
do $$
begin
  if exists (
    select 1
      from public.pr_tags c
      join public.pr_tags p on p.id = c.parent
     where p.parent is not null
  ) then
    raise exception 'pr_tags: el árbol de etiquetas admite UN solo nivel';
  end if;
end $$;
