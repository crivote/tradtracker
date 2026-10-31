-- 011 — Quinto peldaño `shaky`, entre `learning` y `playing_along` (#46)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- La escalera de capacidad pasa de cuatro a cinco peldaños. El que faltaba es
-- el de la pieza que se sabe de estructura pero no entera: se pasa de arriba
-- abajo, pero hay fragmentos que no salen o donde el ritmo se va. Va **antes**
-- de `playing_along` porque seguir a otro es más fácil que sacarla uno solo.
--
--   to_learn → learning → shaky → playing_along → solo_ready
--
-- No hay migración de datos: ningún valor viejo se convierte y `shaky` nace
-- vacío. El orden de la escalera no vive en la base (no hay columna de rango);
-- lo fija `BANDS` en `src/lib/repertoire-model.ts`, y por eso este corte no
-- necesita tocar `status_changed_at` ni el trigger.
--
-- Idempotente: soltar y volver a crear el CHECK deja el mismo estado si se
-- reaplica. Los dos nombres posibles son el inline de 001 y el de 006.

alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_check;
alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_chk;

alter table public.pr_repertoire
  add constraint pr_repertoire_status_chk
  check (status in ('to_learn', 'learning', 'shaky', 'playing_along', 'solo_ready'));
