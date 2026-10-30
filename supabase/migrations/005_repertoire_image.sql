-- 005 — Fondo del tune: nueve candidatos por API (#31)
-- Proyecto Supabase: msysmkaqmefvyemzqftf
--
-- La imagen mnemónica vive en la fila del repertorio, no en una tabla aparte:
-- el ancla es personal y dos usuarios pueden querer fondos distintos para la
-- misma tune, igual que ya pasa con `image_path`. La política existente
-- `pr_repertoire_all` (user_id = auth.uid()) ya la cubre; no hace falta política
-- nueva.
--
-- `image_path` (subida manual, F10) se queda como está: esta migración solo
-- añade las columnas de la elección por API.
--
-- Todo es `add column if not exists`: la migración se puede reaplicar sobre un
-- proyecto a medias sin romper nada.

alter table public.pr_repertoire
  add column if not exists image_source text
    constraint pr_repertoire_image_source_chk
    check (image_source is null or image_source in ('commons', 'pexels', 'upload'));

-- Id del proveedor: nombre de fichero en Commons, id numérico en Pexels.
alter table public.pr_repertoire
  add column if not exists image_id text;

-- Miniatura (330 px en Commons, `medium` en Pexels): es la que pinta la carta.
alter table public.pr_repertoire
  add column if not exists image_thumb_url text;

-- Grande (960 px / `large2x`): solo para el encuadre y el detalle.
alter table public.pr_repertoire
  add column if not exists image_full_url text;

-- Ficha original del proveedor: da el crédito y el «Ver ficha».
alter table public.pr_repertoire
  add column if not exists image_page_url text;

alter table public.pr_repertoire
  add column if not exists image_author text;

alter table public.pr_repertoire
  add column if not exists image_license text;

alter table public.pr_repertoire
  add column if not exists image_license_url text;

-- Encuadre: punto focal en porcentaje y zoom entre 100 % y 220 %.
alter table public.pr_repertoire
  add column if not exists image_focal_x smallint default 50
    constraint pr_repertoire_image_focal_x_chk
    check (image_focal_x is null or image_focal_x between 0 and 100);

alter table public.pr_repertoire
  add column if not exists image_focal_y smallint default 50
    constraint pr_repertoire_image_focal_y_chk
    check (image_focal_y is null or image_focal_y between 0 and 100);

alter table public.pr_repertoire
  add column if not exists image_zoom numeric(3,2) default 1.00
    constraint pr_repertoire_image_zoom_chk
    check (image_zoom is null or image_zoom between 1 and 2.2);

alter table public.pr_repertoire
  add column if not exists image_chosen_at timestamptz;
