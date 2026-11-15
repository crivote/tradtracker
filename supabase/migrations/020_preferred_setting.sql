-- 020 — Versión preferida del ABC por fila del repertorio (#59).
--
-- TheSession sirve todos los settings de una tune en `/tunes/{id}/abc`; el
-- catálogo compartido solo guarda uno. La preferencia es del usuario y de la
-- tune, así que vive aquí y no en `localStorage`: tiene que seguir al dueño
-- entre dispositivos.
--
-- `text` a propósito: el id es el de setting de TheSession (`setting12342`,
-- sacado de la línea `S:` del bloque) y, cuando la versión no lo trae, el
-- cliente usa `n<índice>`. La columna no interpreta el valor.
--
-- Nullable y sin default: `null` = «no hay preferencia» y manda la primera
-- versión, que es el comportamiento anterior a este corte. Aditiva: el cliente
-- desplegado no la pide y no se entera.

alter table public.pr_repertoire
  add column if not exists preferred_setting text;

comment on column public.pr_repertoire.preferred_setting is
  'Versión de ABC preferida para esta tune (id de setting de TheSession, o n<índice>). null = la primera.';
