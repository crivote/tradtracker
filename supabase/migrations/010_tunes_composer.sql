-- 010 — Autor de la tune (`composer`) en el catálogo compartido (#44)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- El subtexto de la fila del listado lleva los invariantes de la pieza —tipo ·
-- compás · autor— y el autor no existía como dato: `pr_tunes` tenía `name,
-- rhythm, meter, key, abc` y nada más. El dato sí está en el artefacto
-- `public/thesession.db` (columna `composer`, por tune), así que la columna se
-- crea aquí y se rellena desde el artefacto con `scripts/backfill-composer.mts`.
--
-- `text` y nulable a propósito: el 72 % del repertorio es tradicional sin autor
-- conocido (`composer` vacío en el artefacto), y una ausencia no se escribe
-- «trad.» —en la UI esa parte del subtexto se omite, no se pinta un guion—. Por
-- eso tampoco hay `not null` ni valor por defecto.
--
-- `pr_tunes` es compartida entre usuarios (`unique (origin, origin_ref)`) y sus
-- políticas `pr_tunes_select` / `pr_tunes_insert` son de fila, no de columna:
-- cubren la columna nueva sin tocar `user_id` ni crear políticas.
--
-- Idempotente: `add column if not exists`, reaplicable.

alter table public.pr_tunes
  add column if not exists composer text;
