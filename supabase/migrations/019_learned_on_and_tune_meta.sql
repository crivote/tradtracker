-- 019: fecha aproximada de aprendizaje por fila de repertorio, y metadatos
-- editoriales del catálogo en una sola columna jsonb.
--
-- `learned_on` es un DÍA, no un instante: marca cuándo se aprendió la tune, que
-- casi nunca se sabe con hora. Cubre las tunes que ya se sabían ANTES de entrar
-- en tuneshed (importaciones; sobre todo el histórico de Folk Companion). Sin
-- esta columna, `added_at` miente sobre la antigüedad del aprendizaje: dice
-- cuándo entró en la app, no cuándo se aprendió. La escribe solo el cliente; no
-- hay trigger ni valor por defecto, porque «no se sabe» es un estado legítimo y
-- frecuente. `NULL` = no se sabe, y no se sustituye por `added_at`.
--
-- `meta` recoge lo que el catálogo de TheSession no trae y no merece una columna
-- por campo: trivia, estructura (AABB), tonalidades alternativas y tradición.
-- Nace como `{}` y no como `NULL` para que ninguna lectura tenga que tratar los
-- dos casos.
alter table public.pr_tunes
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.pr_repertoire
  add column if not exists learned_on date;

comment on column public.pr_repertoire.learned_on is
  'Día aproximado en que se aprendió la tune (YYYY-MM-DD, día local). NULL = no se sabe. Distinto de added_at, que es cuándo entró en tuneshed.';

comment on column public.pr_tunes.meta is
  'Metadatos editoriales sin columna propia: trivia, structure, modes_played[], tradition[]. {} = sin datos.';
