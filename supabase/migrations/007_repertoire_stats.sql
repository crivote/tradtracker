-- 007 — Agregados de ensayo por tune: una fila por fila de repertorio (#29)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- La carta de la home enseña `4.2 avg · 8 practices`, y eso no se puede calcular
-- en el cliente sin traerse todas las líneas de `pr_session_tunes` (con cien
-- tunes y años de historial, eso es la pantalla entera). La vista lo resuelve en
-- la base con **una fila por fila de repertorio**: el `left join` agrupa por
-- `pr_repertoire.id`, así que no multiplica filas por el join.
--
-- `avg_quality` ignora las sesiones sin puntuar (AVG ya descarta los NULL) y
-- devuelve NULL si no queda ninguna valorada: la carta entonces no pinta
-- medidor. `practice_count` cuenta líneas de sesión, valoradas o no: son las
-- veces que se tocó la tune.
--
-- `days_since_last_practice` sale de `pr_repertoire.last_practiced_at` (que
-- mantiene el trigger `pr_session_tunes_touch_trg`); el cliente no escribe esa
-- columna. Los días van crudos, no formateados: el color del tag se calcula en
-- el navegador y necesita el entero.
--
-- **security_invoker = true es obligatorio**: sin eso la vista se evalúa con los
-- permisos del dueño (postgres) y la RLS deja de aplicarse, con lo que
-- cualquiera con la anon key leería el repertorio de todos. Con el invocador, la
-- vista corre como quien consulta y las políticas `user_id = auth.uid()` hacen
-- su trabajo. Comprobado: con la anon key devuelve 0 filas.
--
-- Idempotente: `create or replace` + `grant` reaplicables.

create or replace view public.pr_repertoire_stats
with (security_invoker = true)
as
select
  r.id                                as repertoire_id,
  r.user_id                           as user_id,
  count(st.id)::integer               as practice_count,
  round(avg(st.quality)::numeric, 2)  as avg_quality,
  case
    when r.last_practiced_at is null then null
    else greatest(
           0,
           floor(extract(epoch from (now() - r.last_practiced_at)) / 86400)
         )::integer
  end                                 as days_since_last_practice
from public.pr_repertoire r
left join public.pr_session_tunes st on st.repertoire_id = r.id
group by r.id, r.user_id, r.last_practiced_at;

grant select on public.pr_repertoire_stats to authenticated;
