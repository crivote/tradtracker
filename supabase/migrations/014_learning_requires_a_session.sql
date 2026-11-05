-- 014 — `learning` exige una sesión registrada (#52)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- `learning` significa «conozco las partes pero no me la sé entera», y eso exige
-- haberla tocado. El barrido del 2026-10-31 metió 192 filas ahí, y **182 de ellas
-- no tienen ni una línea de sesión**: un almacén disfrazado de estado. Un estado
-- en transición con 192 entradas no rota nada — es una cola.
--
-- Este UPDATE devuelve al backlog lo que nunca se empezó. Es **derivado** (la
-- regla es «sin sesión no es aprendizaje», que F6 ya tenía escrita como
-- `to_learn → learning` en la primera sesión) y reversible a mano.
--
-- Lo que se paga: `pr_repertoire_touch_trg` mueve `status_changed_at` al cambiar
-- `status`, así que el reloj de dwell de esas filas arranca hoy. No hay forma de
-- conservar el dwell de un estado al que nunca debieron llegar; el taller
-- empieza a medir de cero.
--
-- La regla **no** se queda como restricción de base: un CHECK no puede mirar
-- `pr_session_tunes` y un trigger que degradara al instante tumbaría una tune
-- recién empezada (que todavía no tiene sesión). El mantenimiento hacia delante
-- es la puerta: tope en el repertorio (#52) y `0 practices` a la vista en el
-- banco de trabajo.
--
-- Idempotente: la segunda pasada mueve cero filas.

update public.pr_repertoire r
set status = 'to_learn'
where r.status = 'learning'
  and not exists (
    select 1
    from public.pr_session_tunes st
    where st.repertoire_id = r.id
  );
