-- 013 — `mastered`: la cima de la escalera (#50)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- La escalera de capacidad gana su último peldaño. `solo_ready` dice «la toco
-- sola y correcta, sin apoyo de nadie»; `mastered` dice «improviso variaciones y
-- recursos expresivos con ella» — la pieza con la que uno se luce. No es una
-- escala de calidad: es capacidad, y por eso va encima de `solo_ready` y no en
-- su lugar.
--
--   learning → shaky → playing_along → solo_ready → mastered
--
-- `to_learn` **no** es un peldaño (es el backlog, #50), pero sigue siendo un
-- valor válido de la columna: es el default del alta y el estado de las piezas
-- que aún no se han empezado. El CHECK lo mantiene para no migrar datos.
--
-- Sin migración de datos: ningún valor viejo se convierte y `mastered` nace
-- vacío. El orden de la escalera no vive en la base (no hay columna de rango);
-- lo fija `BANDS` en `src/lib/repertoire-model.ts`.
--
-- Idempotente: soltar y volver a crear el CHECK deja el mismo estado si se
-- reaplica. Los dos nombres posibles son el inline de 001 y el de 006.

alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_check;
alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_chk;

alter table public.pr_repertoire
  add constraint pr_repertoire_status_chk
  check (status in ('to_learn', 'learning', 'shaky', 'playing_along', 'solo_ready', 'mastered'));
