-- 015: el fondo del tune puede venir también del Art Institute of Chicago (issue #31).
--
-- `005` fijó el check en tres fuentes cuando solo había dos por API. Añadir la
-- tercera sin ampliar la restricción hace que el insert falle con un 23514 que
-- el cliente lee como error genérico de guardado, no como «fuente no admitida».
-- Idempotente: se puede aplicar dos veces.

alter table public.pr_repertoire
  drop constraint if exists pr_repertoire_image_source_chk;

alter table public.pr_repertoire
  add constraint pr_repertoire_image_source_chk
  check (image_source is null or image_source in ('commons', 'pexels', 'artic', 'upload'));
