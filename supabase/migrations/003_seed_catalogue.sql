-- 003 — Semilla de catálogo con tunes REALES de TheSession
--
-- Origen de los datos: public/thesession.db (22.775 tunes, artefacto de TradTube).
-- `origin_ref` es el tune_id de TheSession; nombre, tipo y compás salen del catálogo,
-- sin inventar nada. `abc` y `key` quedan NULL: el catálogo no los tiene (decisión A7).
-- Idempotente: reejecutar no duplica (índice único origin+origin_ref) y refresca el nombre.

insert into public.pr_tunes (origin, origin_ref, name, rhythm, meter) values
  ('thesession', '55',  'Kesh, The',                         'jig',      '6/8'),
  ('thesession', '60',  'Lilting Banshee, The',              'jig',      '6/8'),
  ('thesession', '64',  'Maid Behind The Bar, The',          'reel',     '4/4'),
  ('thesession', '71',  'Morrison''s',                       'jig',      '6/8'),
  ('thesession', '73',  'Musical Priest, The',               'reel',     '4/4'),
  ('thesession', '83',  'Rights Of Man, The',                'hornpipe', '4/4'),
  ('thesession', '106', 'Swallowtail, The',                  'jig',      '6/8'),
  ('thesession', '108', 'Out On The Ocean',                  'jig',      '6/8'),
  ('thesession', '116', 'Wind That Shakes The Barley, The',  'reel',     '4/4'),
  ('thesession', '182', 'Silver Spear, The',                 'reel',     '4/4'),
  ('thesession', '248', 'Tam Lin',                           'reel',     '4/4'),
  ('thesession', '475', 'King Of The Fairies',               'hornpipe', '4/4')
on conflict (origin, origin_ref) do update
  set name   = excluded.name,
      rhythm = excluded.rhythm,
      meter  = excluded.meter;
