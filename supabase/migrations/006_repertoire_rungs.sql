-- 006 — Escalera de capacidad: cuatro peldaños y bandera de aparcada (#29)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- El estado deja de ser una escala de calidad de cinco valores y pasa a ser una
-- escalera de capacidad de cuatro: `to_learn`, `learning`, `playing_along`,
-- `solo_ready`. `aparcada` no era una altura más, era otra cosa (una tune
-- guardada en el cajón), así que se convierte en bandera transversal: una tune
-- aparcada puede estar en cualquiera de los cuatro peldaños.
--
-- Migración de lo existente, sin inventar el peldaño que no se conoce:
--   nueva → to_learn · aprendiendo → learning · media → playing_along
--   afianzada → solo_ready · aparcada → learning CON shelved = true
-- De una aparcada no se sabe en qué altura estaba, y ponerla en `solo_ready`
-- sería afirmar algo falso; `learning` es el peldaño neutro de la escalera.
--
-- Idempotente: se puede reaplicar sobre un proyecto a medias. El CHECK viejo se
-- suelta antes de tocar los datos (si no, las filas nuevas no caben) y se vuelve
-- a crear al final, ya con los cuatro valores.
--
-- `status_changed_at` se conserva: el trigger `pr_repertoire_touch_trg` lo
-- reinicia en cada UPDATE de `status`, y un cambio de vocabulario no es un
-- cambio de peldaño. Se desactiva mientras dura la migración de datos.

alter table public.pr_repertoire
  add column if not exists shelved boolean not null default false;

alter table public.pr_repertoire
  alter column status set default 'to_learn';

-- Los dos nombres posibles: el inline de 001 y el de una aplicación anterior de
-- esta misma migración.
alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_check;
alter table public.pr_repertoire drop constraint if exists pr_repertoire_status_chk;

alter table public.pr_repertoire disable trigger pr_repertoire_touch_trg;

update public.pr_repertoire set status = 'to_learn'      where status = 'nueva';
update public.pr_repertoire set status = 'learning'      where status = 'aprendiendo';
update public.pr_repertoire set status = 'playing_along' where status = 'media';
update public.pr_repertoire set status = 'solo_ready'    where status = 'afianzada';
update public.pr_repertoire set status = 'learning', shelved = true
 where status = 'aparcada';

alter table public.pr_repertoire enable trigger pr_repertoire_touch_trg;

alter table public.pr_repertoire
  add constraint pr_repertoire_status_chk
  check (status in ('to_learn', 'learning', 'playing_along', 'solo_ready'));

-- El índice de urgencia de 001 apuntaba a `(user_id, status, last_practiced_at)`:
-- sigue sirviendo tal cual con el vocabulario nuevo, no se toca.
