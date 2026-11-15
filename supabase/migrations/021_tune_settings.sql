-- 021 — La tonalidad pertenece al setting, no a la tune (#61)
--
-- La tune no tiene tonalidad: la tienen sus versiones ABC. Aquí se guarda **solo
-- la tonalidad de cada versión**, no el ABC: el texto ya llega al vuelo desde la
-- API cuando se abre la ficha (#59) y duplicarlo en la base es peso sin valor.
-- Lo que sí aporta es la relación versión → tono: saber en qué tonos se toca una
-- tune y en cuál está la versión que el dueño prefiere, sin pedir nada a la red.
--
-- **Esta migración es aditiva a propósito.** No retira `pr_tunes.key` ni
-- `meta.modes_played`: el cliente desplegado todavía los lee, y quitar la columna
-- en el mismo corte que estrena la nueva abre una ventana —lo que tarda el build
-- de Netlify— en la que la app pide una columna que ya no existe. La retirada va
-- en su propia migración, cuando el cliente ya lea de aquí.
--
-- Idempotente, como el resto: se puede reaplicar sobre un proyecto a medias.
--
-- El respaldo (`pr_tunes_keys_legacy`) se hace aquí, antes de que nadie borre
-- nada: los 271 valores que hoy hay vienen del import de Folk Companion, no de
-- TheSession, y no se tiran sin dejar copia.

-- Un enum y no un CHECK contra una tabla de vocabulario: la lista la publica la
-- fuente y está cerrada (comprobado en las 55.791 filas del volcado y en su
-- selector de búsqueda). El orden manda si alguien ordena por `key`: por tónica
-- y luego por modo. `create type` no admite `if not exists`; el bloque lo cubre.
do $do$
begin
  create type public.pr_tune_key as enum (
    'Amajor', 'Aminor', 'Adorian', 'Amixolydian',
    'Bminor', 'Bdorian', 'Bmixolydian',
    'Cmajor', 'Cdorian',
    'Dmajor', 'Dminor', 'Ddorian', 'Dmixolydian',
    'Emajor', 'Eminor', 'Edorian', 'Emixolydian',
    'Fmajor', 'Fdorian',
    'Gmajor', 'Gminor', 'Gdorian', 'Gmixolydian'
  );
exception
  when duplicate_object then null;
end
$do$;

comment on type public.pr_tune_key is
  'Tonalidad de un setting de TheSession: vocabulario cerrado de 23 valores (tónica + modo).';

create table if not exists public.pr_tune_settings (
  tune_id uuid not null references public.pr_tunes(id) on delete cascade,
  -- Id de setting de TheSession (`1`, `12342`): la identidad estable de la
  -- versión, la misma que ya guarda `pr_repertoire.preferred_setting`.
  setting_ref text not null,
  key public.pr_tune_key not null,
  -- Lo que traiga la fuente si algún día no encaja en el enum. El enum valida;
  -- esta columna evita que una tonalidad nueva de TheSession rompa la carga con
  -- un 23514 que el cliente lee como error genérico.
  key_raw text,
  created_at timestamptz not null default now(),
  -- La clave primaria cubre la consulta por tune (prefijo) y la unicidad.
  primary key (tune_id, setting_ref)
);

comment on table public.pr_tune_settings is
  'Una fila por versión ABC de una tune, con su tonalidad. Sin ABC a propósito: el texto lo trae la API al abrir la ficha. Los tonos de una tune son `select distinct key from pr_tune_settings where tune_id = …`. Se puebla desde el volcado de TheSession solo para las tunes que existen en pr_tunes.';
comment on column public.pr_tune_settings.setting_ref is
  'Id de setting de TheSession. Es la identidad que usa pr_repertoire.preferred_setting.';
comment on column public.pr_tune_settings.key_raw is
  'Tonalidad tal cual llegó, cuando no encaja en el enum. NULL en el caso normal.';

create index if not exists pr_tune_settings_key_idx on public.pr_tune_settings (key);

-- Mismo régimen que el catálogo: todos los autenticados leen; solo el creador de
-- la tune escribe sus versiones (lo granular del alta). La carga masiva va con
-- service_role, que no pasa por RLS.
alter table public.pr_tune_settings enable row level security;

drop policy if exists pr_tune_settings_select on public.pr_tune_settings;
create policy pr_tune_settings_select on public.pr_tune_settings
  for select to authenticated using (true);

drop policy if exists pr_tune_settings_insert on public.pr_tune_settings;
create policy pr_tune_settings_insert on public.pr_tune_settings
  for insert to authenticated
  with check (exists (
    select 1 from public.pr_tunes t
    where t.id = tune_id and t.created_by = auth.uid()
  ));

drop policy if exists pr_tune_settings_update on public.pr_tune_settings;
create policy pr_tune_settings_update on public.pr_tune_settings
  for update to authenticated
  using (exists (
    select 1 from public.pr_tunes t
    where t.id = tune_id and t.created_by = auth.uid()
  ))
  with check (exists (
    select 1 from public.pr_tunes t
    where t.id = tune_id and t.created_by = auth.uid()
  ));

drop policy if exists pr_tune_settings_delete on public.pr_tune_settings;
create policy pr_tune_settings_delete on public.pr_tune_settings
  for delete to authenticated
  using (exists (
    select 1 from public.pr_tunes t
    where t.id = tune_id and t.created_by = auth.uid()
  ));

-- Respaldo de lo que la migración siguiente retirará. Sin políticas: es un
-- archivo, solo lo lee service_role.
create table if not exists public.pr_tunes_keys_legacy (
  tune_id uuid primary key references public.pr_tunes(id) on delete cascade,
  key_text text,
  modes_played jsonb,
  archived_at timestamptz not null default now()
);

comment on table public.pr_tunes_keys_legacy is
  'Copia de pr_tunes.key y meta.modes_played (import de Folk Companion) antes de retirarlos. Solo lectura con service_role.';

insert into public.pr_tunes_keys_legacy (tune_id, key_text, modes_played)
select id, key, meta -> 'modes_played'
from public.pr_tunes
where (key is not null and btrim(key) <> '')
   or meta ? 'modes_played'
on conflict (tune_id) do nothing;

alter table public.pr_tunes_keys_legacy enable row level security;
