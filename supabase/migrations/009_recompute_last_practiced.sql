-- 009 — Recalcular `last_practiced_at` desde las sesiones (F6)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- El trigger `pr_session_tunes_touch_trg` (004) solo **avanza** la fecha:
-- `greatest(coalesce(last_practiced_at, v_started), v_started)`. Es lo correcto
-- al apuntar un ensayo, pero deja la columna mintiendo cuando una sesión
-- desaparece: borrar la única sesión de una tune, o la más reciente, no mueve
-- la fecha hacia atrás. Esta función la recalcula entera desde el historial.
--
-- El criterio es **idéntico al del trigger**: `max(started_at)` de las sesiones
-- del propio usuario que tocaron esa tune. No es la fecha del borrado, ni
-- `now()`, ni la de la línea de `pr_session_tunes`: `started_at` es la hora a la
-- que se tocó, y una sesión retroactiva («ayer practiqué estas cinco») cuenta
-- por su `started_at`, no por cuándo se apuntó.
--
-- Escribe `null` cuando no queda ninguna sesión: «nunca practicada» es un dato,
-- y dejarla con la fecha vieja sería justo el error que corrige esto.
--
-- **security definer es obligatorio**: la función tiene que poder escribir la
-- fila aunque el llamante no tenga permiso de update directo sobre ella, y así
-- el recálculo no depende de qué políticas RLS estén activas en ese momento.
-- Por eso mismo comprueba la propiedad a mano: sin el `user_id = auth.uid()`
-- del `where`, un usuario autenticado podría recalcular filas ajenas. Y por eso
-- lleva `set search_path = public`: sin él, un `search_path` manipulado por el
-- llamante podría resolver `pr_repertoire` (o `auth.uid()`) a un objeto suyo y
-- ejecutar código arbitrario con los privilegios del dueño de la función.
--
-- Sin usuario (llamada anónima o sin sesión) devuelve null sin tocar nada. Si la
-- fila no existe o no es suya, también null y **sin lanzar error**: «no es tuya»
-- y «ya no está» son el mismo caso para quien llama, que acaba de borrar una
-- sesión y no debe ver fallar la operación por eso.
--
-- Idempotente: `create or replace` (la firma no cambia) y permisos reaplicables.

create or replace function public.pr_recompute_last_practiced(p_repertoire_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_last timestamptz;
begin
  if v_user is null then
    return null;
  end if;

  -- Propiedad primero, y en silencio: no se distingue «no existe» de «no es
  -- tuya», para no convertir la función en un oráculo de ids ajenos.
  if not exists (
    select 1
      from public.pr_repertoire r
     where r.id = p_repertoire_id
       and r.user_id = v_user
  ) then
    return null;
  end if;

  select max(s.started_at)
    into v_last
    from public.pr_session_tunes st
    join public.pr_sessions s on s.id = st.session_id
   where st.repertoire_id = p_repertoire_id
     and s.user_id = v_user;

  update public.pr_repertoire r
     set last_practiced_at = v_last
   where r.id = p_repertoire_id
     and r.user_id = v_user;

  return v_last;
end;
$$;

revoke all on function public.pr_recompute_last_practiced(uuid) from public;
grant execute on function public.pr_recompute_last_practiced(uuid) to authenticated;
