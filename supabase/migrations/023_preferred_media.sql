-- 023 — Vídeo preferido de la tune: el pin del usuario sobre TradTube.
--
-- TradTube devuelve **todos** los vídeos de una tune (`tune_media_entries`) y
-- hasta ahora tuneshed abría siempre el primero disponible: el dueño no podía
-- fijar el suyo. La preferencia es de la persona y de la tune, así que vive en
-- la fila del repertorio y sigue al dueño entre dispositivos, igual que
-- `preferred_setting` (020) y por la misma razón: `localStorage` no viaja.
--
-- `text` a propósito: el valor es el `tune_media.id` (uuid) de TradTube y esta
-- base no lo interpreta ni lo valida. `null` = «sin preferencia» y manda el
-- primer vídeo disponible, que es el comportamiento anterior a este corte.
--
-- Aditiva y nullable: el cliente desplegado no la pide y no se entera. Un id
-- que ya no exista en TradTube se ignora al leer —se cae al primer disponible—
-- así que una preferencia huérfana no puede dejar la tune sin vídeo.

alter table public.pr_repertoire
  add column if not exists preferred_media text;

comment on column public.pr_repertoire.preferred_media is
  'Vídeo preferido de la tune (id de tune_media de TradTube). null = el primero disponible.';
