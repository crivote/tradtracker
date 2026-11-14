-- 018_retire_session_model.sql
-- Paso 3 de #56 (#57): retirar el modelo de sesión, ya sin lectores desde el despliegue del cliente nuevo.
--
-- El orden importa y no es cosmético: el `before trigger` de hoy deriva `last_practiced_day` **de**
-- `last_practiced_at`. Si se quita la columna sin rewirar el trigger, la fecha del último ensayo deja de
-- actualizarse EN SILENCIO: ninguna consulta falla y la home ordena por abandono con datos viejos.
--
-- Idempotente: cada paso tolera reejecutarse.

-- ── 1. La vista de estadísticas deja de contar líneas de sesión ────────────
-- Depende de `last_practiced_at` y de `pr_session_tunes`: sin redefinirla, el DROP COLUMN falla. Pasa a
-- contar **marcas** y a medir los días desde el día local (no desde el instante, y no en UTC).
create or replace view public.pr_repertoire_stats
with (security_invoker = true) as
select r.id as repertoire_id,
       r.user_id,
       count(p.id)::integer as practice_count,
       round(avg(p.quality), 2) as avg_quality,
       case
         when r.last_practiced_day is null then null::integer
         else greatest(0, ((now() at time zone 'Europe/Madrid')::date - r.last_practiced_day))::integer
       end as days_since_last_practice
from public.pr_repertoire r
left join public.pr_practice p on p.repertoire_id = r.id
group by r.id, r.user_id, r.last_practiced_day;

-- ── 2. Fuera los disparadores y funciones del modelo viejo ────────────────
drop trigger if exists pr_session_tunes_touch_trg on public.pr_session_tunes;
drop function if exists public.pr_session_tunes_touch();
drop function if exists public.pr_recompute_last_practiced(uuid);

-- El que movía `last_practiced_at` al marcar, y el que derivaba el día de ese instante.
drop trigger if exists pr_practice_touch_trg on public.pr_practice;
drop function if exists public.pr_practice_touch();
drop trigger if exists pr_repertoire_day_sync_trg on public.pr_repertoire;
drop function if exists public.pr_repertoire_day_sync();

-- ── 3. El día pasa a derivarse de `pr_practice` ───────────────────────────
-- Recalcula el máximo por tune en cada alta, cambio o borrado de marca: cubre el avance (sin necesidad de
-- `greatest`) y también el retroceso al borrar la última.
create or replace function public.pr_practice_sync_day()
returns trigger
language plpgsql
as $$
declare
  rid uuid := coalesce(new.repertoire_id, old.repertoire_id);
  d date;
begin
  select max(day) into d from public.pr_practice where repertoire_id = rid;
  update public.pr_repertoire set last_practiced_day = d where id = rid;
  return null;
end;
$$;

drop trigger if exists pr_practice_sync_day_trg on public.pr_practice;

create trigger pr_practice_sync_day_trg
  after insert or update or delete on public.pr_practice
  for each row execute function public.pr_practice_sync_day();

-- La RPC que el cliente llama al desmarcar deja de escribir la columna vieja.
create or replace function public.pr_recompute_last_practice(p_repertoire_id uuid)
returns void
language plpgsql
as $$
begin
  update public.pr_repertoire r
     set last_practiced_day = (
           select max(p.day) from public.pr_practice p where p.repertoire_id = r.id
         )
   where r.id = p_repertoire_id;
end;
$$;

-- ── 4. Fuera la columna del instante, y el índice que la usaba ────────────
alter table public.pr_repertoire drop column if exists last_practiced_at;

create index if not exists pr_repertoire_urgency_day_idx
  on public.pr_repertoire (user_id, status, last_practiced_day);

-- ── 5. Recalcular el día en todas las filas desde la fuente nueva ─────────
update public.pr_repertoire r
   set last_practiced_day = (
         select max(p.day) from public.pr_practice p where p.repertoire_id = r.id
       );

-- ── 6. Las tablas de sesión quedan como archivo muerto ────────────────────
alter table if exists public.pr_sessions rename to pr_sessions_legacy;
alter table if exists public.pr_session_tunes rename to pr_session_tunes_legacy;
