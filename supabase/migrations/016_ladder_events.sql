-- 016_ladder_events.sql
-- Registro append-only de las transiciones del peldaño y de la bandera shelved (#55).
--
-- Hasta hoy solo quedaba el estado actual y `status_changed_at`, que el trigger
-- `pr_repertoire_touch` REESCRIBE en cada cambio: se conocía el último cambio, nunca el anterior, y
-- `shelved` no dejaba rastro. Con esto se reconstruye cualquier semana pasada, se mide el dwell real por
-- peldaño y la ficha puede contar la vida de una tune.
--
-- Idempotente: se puede reejecutar tras un fallo parcial (por esta vía no hay tabla de migraciones).

create table if not exists public.pr_ladder_event (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  repertoire_id uuid not null references public.pr_repertoire(id) on delete cascade,
  kind          text not null check (kind in ('status','shelved')),
  from_value    text,
  to_value      text not null,
  at            timestamptz not null default now(),
  source        text not null default 'ui'
);

create index if not exists pr_ladder_event_rep_idx
  on public.pr_ladder_event (repertoire_id, at);

create index if not exists pr_ladder_event_user_idx
  on public.pr_ladder_event (user_id, at);

alter table public.pr_ladder_event enable row level security;

drop policy if exists pr_ladder_event_all on public.pr_ladder_event;
create policy pr_ladder_event_all on public.pr_ladder_event
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Un evento por cambio real; ninguno cuando no cambia nada. La procedencia sale de
-- `app.write_source` para poder marcar importaciones y migraciones y excluirlas de las gráficas.
create or replace function public.pr_ladder_event_log()
returns trigger
language plpgsql
as $$
declare
  src text := coalesce(current_setting('app.write_source', true), 'ui');
begin
  if tg_op = 'INSERT' then
    insert into public.pr_ladder_event (user_id, repertoire_id, kind, from_value, to_value, source)
    values (new.user_id, new.id, 'status', null, new.status, src);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.pr_ladder_event (user_id, repertoire_id, kind, from_value, to_value, source)
    values (new.user_id, new.id, 'status', old.status, new.status, src);
  end if;

  if new.shelved is distinct from old.shelved then
    insert into public.pr_ladder_event (user_id, repertoire_id, kind, from_value, to_value, source)
    values (new.user_id, new.id, 'shelved', old.shelved::text, new.shelved::text, src);
  end if;

  return new;
end;
$$;

drop trigger if exists pr_ladder_event_trg on public.pr_repertoire;

create trigger pr_ladder_event_trg
  after insert or update on public.pr_repertoire
  for each row execute function public.pr_ladder_event_log();

-- Backfill: una fila por estado actual, fechada en status_changed_at y marcada como tal.
-- No es una transición: es la última foto conocida. Reejecutable.
insert into public.pr_ladder_event (user_id, repertoire_id, kind, from_value, to_value, at, source)
select r.user_id, r.id, 'status', null, r.status, r.status_changed_at, 'backfill'
from public.pr_repertoire r
where not exists (
  select 1 from public.pr_ladder_event e
  where e.repertoire_id = r.id and e.kind = 'status' and e.source = 'backfill'
);
