-- 002 — Alta de repertorio sin pasar `user_id` desde el cliente
--
-- La RLS de pr_repertoire ya exige `user_id = auth.uid()` en el WITH CHECK, pero
-- la columna era `not null` sin default: el cliente tenía que enviar su propio uuid
-- (dato de confianza enviado por el navegador). Con el default en auth.uid() el
-- cliente inserta solo `tune_id` y la base resuelve el dueño. D3: multiusuario.

alter table public.pr_repertoire
  alter column user_id set default auth.uid();
