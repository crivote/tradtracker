-- 008 — Flag `favorite` en el repertorio (F6: listas de ensayo)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- Palanca de priorización de F6: marcar una tune como favorita sirve para
-- armar la lista de ensayo del día, no para decir cómo de bien se toca. NO
-- sustituye a `rating` (que mide la calidad de la última práctica) ni cambia el
-- peldaño `status` ni la bandera `shelved`: convive con los tres.
--
-- La política existente `pr_repertoire_all` (`for all to authenticated using
-- (user_id = auth.uid())`) cubre la columna nueva sin tocar nada: es de fila, no
-- de columna. No hace falta política ni índice nuevos: la bandera se filtra
-- siempre junto a `user_id`, que ya está indexado.
--
-- Idempotente: `add column if not exists`, reaplicable.

alter table public.pr_repertoire
  add column if not exists favorite boolean not null default false;
